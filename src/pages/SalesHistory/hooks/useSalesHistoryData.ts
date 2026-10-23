import { useState, useEffect, useCallback, useRef } from 'react';
import { salesApi } from '../../../api/sales';
import { restoreFocusWithFallback } from '../../../utils/focusUtils';
import type { Sale, SalesHistoryServerRange } from '../../../types';

interface UseSalesHistoryDataOptions {
  userId: string | null;
  /** A role change clears loaded receipts and reloads them (like a user switch). */
  isAdmin: boolean;
  range: SalesHistoryServerRange;
  isModalOpen: () => boolean;
}

/**
 * Loads receipts (sales + sale_items) of the history page from Supabase — only sales, no catalog.
 * - Reloads when the SERVER range changes (period / custom dates / calendar day); client-side
 *   search, payment filter, sorting and pagination never hit the server.
 * - Every load aborts the previous one; stale or aborted responses are ignored silently.
 * - Data is cleared when the range or the authenticated user changes, so results of a previous
 *   period are never shown as the current report.
 * - `hasAnySales` distinguishes "no sales at all" from "nothing in this period": it is derived
 *   from loaded data and, only when a ranged server load is empty, from a lightweight `id` probe.
 */
export const useSalesHistoryData = ({ userId, isAdmin, range, isModalOpen }: UseSalesHistoryDataOptions) => {
  const [sales, setSales] = useState<Sale[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(Boolean(userId) && range.kind !== 'invalid');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isTruncated, setIsTruncated] = useState<boolean>(false);
  const [hasAnySales, setHasAnySales] = useState<boolean | null>(null);
  const hasAnySalesRef = useRef<boolean | null>(hasAnySales);
  useEffect(() => {
    hasAnySalesRef.current = hasAnySales;
  }, [hasAnySales]);

  const abortControllerRef = useRef<AbortController | null>(null);
  const probeControllerRef = useRef<AbortController | null>(null);
  const isMountedRef = useRef<boolean>(true);
  const rangeRef = useRef(range);
  useEffect(() => {
    rangeRef.current = range;
  }, [range]);

  // Reset on user switch / logout and on server range change (render-phase state adjustment)
  const [prevUserId, setPrevUserId] = useState<string | null>(userId);
  const [prevRangeKey, setPrevRangeKey] = useState<string>(range.key);
  const [prevIsAdmin, setPrevIsAdmin] = useState<boolean>(isAdmin);
  if (prevUserId !== userId || prevRangeKey !== range.key || prevIsAdmin !== isAdmin) {
    const userChanged = prevUserId !== userId;
    setPrevUserId(userId);
    setPrevRangeKey(range.key);
    setPrevIsAdmin(isAdmin);
    setSales([]);
    setIsTruncated(false);
    setLoadError(null);
    setIsLoading(Boolean(userId) && range.kind !== 'invalid');
    if (userChanged) {
      setHasAnySales(null);
    }
  }

  /**
   * Existence probe. It is aborted on range / user change, and its answer is applied only while it
   * is still the latest probe; a known `true` (from loaded receipts) is never overwritten.
   */
  const probeHasAnySales = useCallback(async () => {
    probeControllerRef.current?.abort();
    const controller = new AbortController();
    probeControllerRef.current = controller;
    try {
      const res = await salesApi.hasAnySales(controller.signal);
      if (
        !isMountedRef.current ||
        controller.signal.aborted ||
        probeControllerRef.current !== controller
      ) {
        return;
      }
      if (res.success) {
        setHasAnySales((known) => (known === true ? true : res.data));
      }
    } catch {
      // Aborted or failed probe: keep "unknown" (the filtered empty state is shown)
    }
  }, []);

  const loadSales = useCallback(
    async (isRetry = false) => {
      const currentRange = rangeRef.current;
      if (!userId || currentRange.kind === 'invalid') return;

      abortControllerRef.current?.abort();
      const controller = new AbortController();
      abortControllerRef.current = controller;
      const isCurrent = () =>
        isMountedRef.current &&
        !controller.signal.aborted &&
        abortControllerRef.current === controller;

      setIsLoading(true);
      if (!isRetry) {
        setLoadError(null);
      }
      let resSuccess = false;
      let needsProbe = false;

      try {
        const res = await salesApi.fetchSales({
          signal: controller.signal,
          soldFrom: currentRange.kind === 'range' ? currentRange.soldFrom : undefined,
          soldBefore: currentRange.kind === 'range' ? currentRange.soldBefore : undefined,
        });
        if (!isCurrent()) return;

        if (res.success) {
          resSuccess = true;
          setLoadError(null);
          setSales(res.data.sales);
          setIsTruncated(res.data.isTruncated);
          if (res.data.sales.length > 0) {
            setHasAnySales(true);
          } else if (currentRange.kind === 'all') {
            setHasAnySales(false);
          } else {
            needsProbe = true;
          }
        } else {
          setLoadError(res.error.message);
        }
      } catch (err: unknown) {
        if ((err instanceof DOMException && err.name === 'AbortError') || !isCurrent()) {
          return;
        }
        setLoadError('Не удалось загрузить историю продаж. Проверьте подключение к сети.');
      } finally {
        if (isCurrent()) {
          setIsLoading(false);
          if (isRetry) {
            requestAnimationFrame(() => {
              if (!isMountedRef.current || isModalOpen()) return;
              // Restore focus only if it was lost (retry button disabled / removed) — never steal it
              // from an element the user focused meanwhile
              const active = document.activeElement;
              const isFocusLost =
                !active ||
                active === document.body ||
                Boolean(active.closest?.('[data-retry-sales-history-btn]'));
              if (!isFocusLost) return;
              if (resSuccess) {
                restoreFocusWithFallback(null, '[data-sales-history-search]');
              } else {
                const retryBtn = document.querySelector<HTMLButtonElement>(
                  '[data-retry-sales-history-btn]'
                );
                if (retryBtn && !retryBtn.disabled) {
                  retryBtn.focus();
                } else {
                  restoreFocusWithFallback(null, '[data-sales-history-search]');
                }
              }
            });
          }
        }
      }

      // Only an empty ranged result leaves "are there any sales at all?" open. `true` is final
      // (sales cannot be deleted: no DELETE grants, FK ON DELETE RESTRICT), while `false` or
      // unknown is re-checked on every empty SERVER load — never on client-side filter changes.
      if (needsProbe && isCurrent() && hasAnySalesRef.current !== true) {
        void probeHasAnySales();
      }
    },
    [userId, isModalOpen, probeHasAnySales]
  );

  // Load on mount, on user / role change and on server range change
  useEffect(() => {
    if (!userId || range.kind === 'invalid') {
      abortControllerRef.current?.abort();
      probeControllerRef.current?.abort();
      return;
    }

    void Promise.resolve().then(() => {
      if (isMountedRef.current) {
        void loadSales();
      }
    });

    return () => {
      abortControllerRef.current?.abort();
      probeControllerRef.current?.abort();
    };
  }, [userId, isAdmin, range.key, range.kind, loadSales]);

  // Abort everything on unmount
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      abortControllerRef.current?.abort();
      probeControllerRef.current?.abort();
    };
  }, []);

  const retry = useCallback(() => {
    void loadSales(true);
  }, [loadSales]);

  return {
    sales,
    isLoading,
    loadError,
    isTruncated,
    hasAnySales,
    retry,
  };
};
