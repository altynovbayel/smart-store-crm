import { useState, useEffect, useCallback, useRef } from 'react';
import type { DashboardApiResult, DashboardSalesSummary, DashboardStockSummary } from '../../../types';
import { dashboardApi } from '../../../api/dashboard';
import { buildDashboardDayBounds } from '../../../utils/dashboardCalculations';
import { formatCalendarDateKey } from '../../../utils/dateUtils';
import { restoreFocusWithFallback } from '../../../utils/focusUtils';

/** Minimum age of the last successful load before a focus / visibility refresh. */
export const DASHBOARD_REFRESH_INTERVAL_MS = 60_000;

interface SourceState<T> {
  data: T | null;
  isLoading: boolean;
  error: string | null;
}

const initialState = <T,>(enabled: boolean): SourceState<T> => ({
  data: null,
  isLoading: enabled,
  error: null,
});

interface UseDashboardDataOptions {
  userId: string | null;
  currentDateKey: string;
  /** Injectable clock for tests. */
  now?: () => number;
}

type Fetcher<T> = (signal: AbortSignal) => Promise<DashboardApiResult<T>>;

/**
 * One independent Dashboard data source (sales summary OR stock summary):
 * its own loading / error / retry, AbortController and "last success" timestamp,
 * so an error in one source never hides the other.
 */
const useDashboardSource = <T,>(
  userId: string | null,
  /** Data is cleared whenever this key changes (user switch; for sales also the calendar day). */
  resetKey: string,
  retryButtonSelector: string,
  /** Where focus goes after a successful retry when the (now removed) retry button had it. */
  successFocusSelector: string,
  now: () => number
) => {
  const [state, setState] = useState<SourceState<T>>(() => initialState<T>(Boolean(userId)));
  const controllerRef = useRef<AbortController | null>(null);
  const lastSuccessAtRef = useRef<number | null>(null);
  const isMountedRef = useRef<boolean>(true);

  // Never show data of a previous user or of a previous "today" while the new load is running
  const [prevResetKey, setPrevResetKey] = useState<string>(resetKey);
  if (prevResetKey !== resetKey) {
    setPrevResetKey(resetKey);
    setState(initialState<T>(Boolean(userId)));
  }

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      controllerRef.current?.abort();
    };
  }, []);

  // A user switch invalidates the "fresh data" timestamp and any in-flight request
  useEffect(() => {
    lastSuccessAtRef.current = null;
    return () => {
      controllerRef.current?.abort();
    };
  }, [userId]);

  const load = useCallback(
    async (fetcher: Fetcher<T>, isRetry = false) => {
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      const isCurrent = () =>
        isMountedRef.current && !controller.signal.aborted && controllerRef.current === controller;

      setState((prev) => ({ ...prev, isLoading: true, error: isRetry ? prev.error : null }));
      let succeeded = false;

      try {
        const res = await fetcher(controller.signal);
        if (!isCurrent()) return;
        if (res.success) {
          succeeded = true;
          lastSuccessAtRef.current = now();
          setState({ data: res.data, isLoading: false, error: null });
        } else {
          // Keep the last successful data visible; show the error next to it
          setState((prev) => ({ ...prev, isLoading: false, error: res.error.message }));
        }
      } catch (err: unknown) {
        if ((err instanceof DOMException && err.name === 'AbortError') || !isCurrent()) return;
        setState((prev) => ({
          ...prev,
          isLoading: false,
          error: 'Не удалось загрузить показатели. Проверьте подключение к сети.',
        }));
      } finally {
        if (isRetry && isCurrent()) {
          requestAnimationFrame(() => {
            if (!isMountedRef.current) return;
            // Restore focus only if it was lost (retry button disabled / removed) — never steal it
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
    () => lastSuccessAtRef.current === null || now() - lastSuccessAtRef.current >= DASHBOARD_REFRESH_INTERVAL_MS,
    [now]
  );

  return { state, load, isStale };
};

const systemNow = () => Date.now();

/**
 * Dashboard data from the read-only aggregation RPCs only (no InventoryContext, no table SELECTs).
 * - Sales summary reloads on mount, user switch and calendar day change (new local bounds).
 * - Stock summary reloads on mount and user switch.
 * - Returning to the tab (focus / visibilitychange) refreshes a source only if its last successful
 *   load is at least 60 s old.
 */
export const useDashboardData = ({ userId, currentDateKey, now = systemNow }: UseDashboardDataOptions) => {
  // Keep the clock in a ref: an inline `now` must never recreate loaders / effects on every render
  const nowRef = useRef(now);
  useEffect(() => {
    nowRef.current = now;
  }, [now]);
  const stableNow = useCallback(() => nowRef.current(), []);

  const sales = useDashboardSource<DashboardSalesSummary>(
    userId,
    `${userId ?? ''}|${currentDateKey}`,
    '[data-retry-dashboard-sales-btn]',
    '[data-dashboard-recent-sales-link]',
    stableNow
  );
  const stock = useDashboardSource<DashboardStockSummary>(
    userId,
    userId ?? '',
    '[data-retry-dashboard-stock-btn]',
    '[data-dashboard-low-stock-link]',
    stableNow
  );
  const loadSalesSource = sales.load;
  const loadStockSource = stock.load;

  const dateKeyRef = useRef(currentDateKey);
  useEffect(() => {
    dateKeyRef.current = currentDateKey;
  }, [currentDateKey]);

  const loadSales = useCallback(
    (isRetry = false) => {
      const bounds = buildDashboardDayBounds(dateKeyRef.current);
      if (!bounds) return;
      void loadSalesSource((signal) => dashboardApi.fetchSalesSummary(bounds, signal), isRetry);
    },
    [loadSalesSource]
  );

  const loadStock = useCallback(
    (isRetry = false) => {
      void loadStockSource((signal) => dashboardApi.fetchStockSummary(signal), isRetry);
    },
    [loadStockSource]
  );

  // Sales: mount, user switch, calendar day change
  useEffect(() => {
    if (!userId) return;
    loadSales();
  }, [userId, currentDateKey, loadSales]);

  // Stock: mount, user switch
  useEffect(() => {
    if (!userId) return;
    loadStock();
  }, [userId, loadStock]);

  // Throttled refresh when the user returns to the tab
  const salesIsStale = sales.isStale;
  const stockIsStale = stock.isStale;
  useEffect(() => {
    if (!userId) return;
    const handleReturn = () => {
      if (document.visibilityState === 'hidden') return;
      // A new calendar day is handled by the date-key effect (fresh bounds) — avoid a stale-day load
      const dayUnchanged = formatCalendarDateKey(new Date()) === dateKeyRef.current;
      if (dayUnchanged && salesIsStale()) loadSales();
      if (stockIsStale()) loadStock();
    };
    window.addEventListener('focus', handleReturn);
    document.addEventListener('visibilitychange', handleReturn);
    return () => {
      window.removeEventListener('focus', handleReturn);
      document.removeEventListener('visibilitychange', handleReturn);
    };
  }, [userId, loadSales, loadStock, salesIsStale, stockIsStale]);

  const retrySales = useCallback(() => loadSales(true), [loadSales]);
  const retryStock = useCallback(() => loadStock(true), [loadStock]);

  return {
    sales: sales.state,
    stock: stock.state,
    retrySales,
    retryStock,
  };
};
