import { useState, useEffect, useRef } from 'react';
import type { HistoricalPriceResult, MappedApiError, Product } from '../types';
import { parseCustomDate } from '../utils/dateUtils';

const EMPTY_PRICES: Record<string, HistoricalPriceResult> = {};

export type HistoricalPriceStatus = 'idle' | 'loading' | 'ready' | 'error';

/**
 * Module-level fetcher (must be a stable reference) returning prices resolved by the server
 * exactly like the document RPC; all-or-nothing (never a partial set of prices).
 */
export type HistoricalPriceFetcher = (
  productIds: string[],
  occurredAt: string,
  signal?: AbortSignal
) => Promise<
  | { success: true; data: Record<string, HistoricalPriceResult> }
  | { success: false; error: MappedApiError }
>;

interface UseHistoricalPurchasePricesOptions {
  isOpen: boolean;
  documentDate: string;
  items: ReadonlyArray<{ productId: string }>;
  /**
   * Loaded catalog. Not sent to the server; a new catalog instance (reload after a write-off or
   * a refused one) re-requests prices, because the catalog_fallback price may have changed.
   */
  activeProducts: Product[];
  fetchPrices: HistoricalPriceFetcher;
}

/**
 * Loads effective historical purchase prices (as resolved by the document RPC
 * rpc_create_outcome_document) for the selected products at the document date.
 *
 * Race protection: every new request aborts the previous one (AbortController) and carries
 * a monotonically increasing request id; a response is applied only if its controller is not
 * aborted AND its id is still the latest. A stale response for an old occurred_at can therefore
 * never overwrite the result of a newer request.
 *
 * Results are tagged with the (documentDate, product set) they were requested for and are
 * returned only while they match the current form, so validation never sees prices of a previous date.
 */
export const useHistoricalPurchasePrices = ({
  isOpen,
  documentDate,
  items,
  activeProducts,
  fetchPrices,
}: UseHistoricalPurchasePricesOptions) => {
  const [pricesState, setPricesState] = useState<{
    requestKey: string;
    prices: Record<string, HistoricalPriceResult>;
  }>({ requestKey: '', prices: {} });
  const [priceStatus, setPriceStatus] = useState<HistoricalPriceStatus>('idle');
  const [priceErrorMessage, setPriceErrorMessage] = useState<string | null>(null);
  const latestPriceRequestIdRef = useRef<number>(0);

  // Stable primitive key: the effect re-runs only when the set of selected products changes
  const selectedProductIdsKey = Array.from(
    new Set(items.map((it) => it.productId).filter(Boolean))
  )
    .sort()
    .join(',');
  const currentRequestKey = `${documentDate}|${selectedProductIdsKey}`;

  useEffect(() => {
    if (!isOpen) return;

    const controller = new AbortController();
    const currentRequestId = ++latestPriceRequestIdRef.current;
    const requestKey = `${documentDate}|${selectedProductIdsKey}`;
    const isStale = () =>
      controller.signal.aborted || latestPriceRequestIdRef.current !== currentRequestId;

    const selectedProductIds = selectedProductIdsKey
      ? selectedProductIdsKey.split(',')
      : [];

    const runFetch = async () => {
      if (selectedProductIds.length === 0) {
        if (isStale()) return;
        setPricesState({ requestKey, prices: {} });
        setPriceStatus('ready');
        setPriceErrorMessage(null);
        return;
      }

      const parsedDate = parseCustomDate(documentDate);
      if (!parsedDate || isNaN(parsedDate.getTime())) {
        if (isStale()) return;
        setPriceStatus('error');
        setPriceErrorMessage('Укажите корректную дату для расчёта себестоимости');
        return;
      }

      setPriceStatus('loading');
      setPriceErrorMessage(null);

      try {
        const res = await fetchPrices(
          selectedProductIds,
          parsedDate.toISOString(),
          controller.signal
        );

        if (isStale()) return;

        if (res.success) {
          setPricesState({ requestKey, prices: res.data });
          setPriceStatus('ready');
          setPriceErrorMessage(null);
        } else {
          setPricesState({ requestKey, prices: {} });
          setPriceStatus('error');
          setPriceErrorMessage(res.error.message || 'Не удалось загрузить историю цен');
        }
      } catch (err: unknown) {
        if (isStale() || (err instanceof DOMException && err.name === 'AbortError')) {
          return;
        }
        setPricesState({ requestKey, prices: {} });
        setPriceStatus('error');
        setPriceErrorMessage('Ошибка сети при загрузке исторических цен');
      }
    };

    void runFetch();

    return () => {
      controller.abort();
    };
  }, [isOpen, documentDate, selectedProductIdsKey, activeProducts, fetchPrices]);

  const isCurrentResult = pricesState.requestKey === currentRequestKey;
  const historicalPrices = isCurrentResult ? pricesState.prices : EMPTY_PRICES;
  // Until the request for the current selection has started, a "ready" from the previous
  // selection is reported as loading (no total computed from prices of another date / product set)
  const effectiveStatus: HistoricalPriceStatus =
    priceStatus === 'ready' && !isCurrentResult ? 'loading' : priceStatus;

  return { historicalPrices, priceStatus: effectiveStatus, priceErrorMessage };
};
