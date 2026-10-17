import { useState, useEffect, useRef } from 'react';
import type { HistoricalPriceResult, OutcomeFormItemState, Product } from '../../../types';
import { outcomeApi } from '../../../api/outcome';
import { parseCustomDate } from '../../../utils/dateUtils';

const EMPTY_PRICES: Record<string, HistoricalPriceResult> = {};

export type HistoricalPriceStatus = 'idle' | 'loading' | 'ready' | 'error';

interface UseOutcomeHistoricalPricesOptions {
  isOpen: boolean;
  documentDate: string;
  items: OutcomeFormItemState[];
  activeProducts: Product[];
}

/**
 * Loads effective historical purchase prices (as resolved by rpc_create_outcome_document)
 * for the selected products at the document date.
 *
 * Race protection: every new request aborts the previous one (AbortController) and carries
 * a monotonically increasing request id; a response is applied only if its controller is not
 * aborted AND its id is still the latest. A stale response for an old occurred_at can therefore
 * never overwrite the result of a newer request.
 *
 * Results are tagged with the (documentDate, product set) they were requested for and are
 * returned only while they match the current form, so validation never sees prices of a previous date.
 */
export const useOutcomeHistoricalPrices = ({
  isOpen,
  documentDate,
  items,
  activeProducts,
}: UseOutcomeHistoricalPricesOptions) => {
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
        const res = await outcomeApi.fetchHistoricalPurchasePrices(
          selectedProductIds,
          parsedDate.toISOString(),
          activeProducts,
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
  }, [isOpen, documentDate, selectedProductIdsKey, activeProducts]);

  const historicalPrices =
    pricesState.requestKey === currentRequestKey ? pricesState.prices : EMPTY_PRICES;

  return { historicalPrices, priceStatus, priceErrorMessage };
};
