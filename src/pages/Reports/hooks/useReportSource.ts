import { useState, useEffect, useCallback, useRef } from 'react';
import type { ReportsApiResult } from '../../../api/reports';
import { restoreFocusWithFallback } from '../../../utils/focusUtils';

/** Minimum age of the last successful load before a background refresh. */
export const REPORTS_REFRESH_INTERVAL_MS = 60_000;

export interface ReportSourceState<T> {
  data: T | null;
  /** Request key the shown data belongs to (e.g. the sales period). */
  dataKey: string | null;
  /** Primary load: nothing (valid) is shown yet. */
  isLoading: boolean;
  /** Background refresh while the previous data stays visible. */
  isRefreshing: boolean;
  error: string | null;
}

const emptyState = <T,>(): ReportSourceState<T> => ({
  data: null,
  dataKey: null,
  isLoading: false,
  isRefreshing: false,
  error: null,
});

export type ReportLoadMode = 'primary' | 'background' | 'retry';

type Fetcher<T> = (signal: AbortSignal) => Promise<ReportsApiResult<T>>;

interface UseReportSourceOptions {
  /** State is cleared and in-flight requests aborted whenever this key changes (user / role). */
  resetKey: string;
  retryButtonSelector: string;
  /** Focus target after a successful retry when the (removed) retry button had focus. */
  successFocusSelector: string;
  now: () => number;
}

/**
 * One independent Reports data source (sales OR warehouse):
 * own AbortController, loading / refreshing / error state, "last success" timestamp and
 * de-duplication of identical in-flight requests.
 */
export const useReportSource = <T,>({
  resetKey,
  retryButtonSelector,
  successFocusSelector,
  now,
}: UseReportSourceOptions) => {
  const [state, setState] = useState<ReportSourceState<T>>(emptyState);
  const controllerRef = useRef<AbortController | null>(null);
  const inFlightKeyRef = useRef<string | null>(null);
  const lastSuccessAtRef = useRef<number | null>(null);
  const dataKeyRef = useRef<string | null>(null);
  const isMountedRef = useRef<boolean>(true);

  const [prevResetKey, setPrevResetKey] = useState(resetKey);
  if (prevResetKey !== resetKey) {
    setPrevResetKey(resetKey);
    setState(emptyState<T>());
  }

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      controllerRef.current?.abort();
    };
  }, []);

  // A user / role change aborts everything and invalidates cached data
  useEffect(() => {
    lastSuccessAtRef.current = null;
    dataKeyRef.current = null;
    return () => {
      controllerRef.current?.abort();
      controllerRef.current = null;
      inFlightKeyRef.current = null;
    };
  }, [resetKey]);

  /** Aborts the in-flight request and clears all data (e.g. invalid period). */
  const clear = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    inFlightKeyRef.current = null;
    dataKeyRef.current = null;
    lastSuccessAtRef.current = null;
    setState(emptyState<T>());
  }, []);

  const load = useCallback(
    async (key: string, fetcher: Fetcher<T>, mode: ReportLoadMode) => {
      // Never start a second identical request while one is running (an explicit retry restarts it)
      if (inFlightKeyRef.current === key && mode !== 'retry') return;

      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      inFlightKeyRef.current = key;
      const isCurrent = () =>
        isMountedRef.current && !controller.signal.aborted && controllerRef.current === controller;

      if (mode === 'primary') {
        // A different request key: never show data of another period as the new report
        dataKeyRef.current = null;
        setState({ data: null, dataKey: null, isLoading: true, isRefreshing: false, error: null });
      } else {
        setState((prev) => ({
          ...prev,
          isLoading: prev.data === null,
          isRefreshing: prev.data !== null,
          error: mode === 'retry' ? prev.error : null,
        }));
      }

      let succeeded = false;
      try {
        const res = await fetcher(controller.signal);
        if (!isCurrent()) return;
        if (res.success) {
          succeeded = true;
          lastSuccessAtRef.current = now();
          dataKeyRef.current = key;
          setState({ data: res.data, dataKey: key, isLoading: false, isRefreshing: false, error: null });
        } else {
          // Keep valid data of the same key visible; show the error next to it
          setState((prev) => ({ ...prev, isLoading: false, isRefreshing: false, error: res.error.message }));
        }
      } catch (err: unknown) {
        if ((err instanceof DOMException && err.name === 'AbortError') || !isCurrent()) return;
        setState((prev) => ({
          ...prev,
          isLoading: false,
          isRefreshing: false,
          error: 'Не удалось загрузить отчёт. Проверьте подключение к сети.',
        }));
      } finally {
        if (controllerRef.current === controller) {
          inFlightKeyRef.current = null;
        }
        if (mode === 'retry' && isCurrent()) {
          requestAnimationFrame(() => {
            if (!isMountedRef.current) return;
            // Restore focus only if it was lost — never steal it from an element the user chose
            const active = document.activeElement;
            const isFocusLost =
              !active || active === document.body || Boolean(active.closest?.(retryButtonSelector));
            if (!isFocusLost) return;
            if (succeeded) {
              restoreFocusWithFallback(null, successFocusSelector);
              return;
            }
            const retryBtn = document.querySelector<HTMLButtonElement>(retryButtonSelector);
            if (retryBtn && !retryBtn.disabled) retryBtn.focus();
          });
        }
      }
    },
    [now, retryButtonSelector, successFocusSelector]
  );

  const isStale = useCallback(
    () =>
      lastSuccessAtRef.current === null ||
      now() - lastSuccessAtRef.current >= REPORTS_REFRESH_INTERVAL_MS,
    [now]
  );

  const getDataKey = useCallback(() => dataKeyRef.current, []);
  const isInFlight = useCallback(() => inFlightKeyRef.current !== null, []);

  return { state, load, clear, isStale, getDataKey, isInFlight };
};
