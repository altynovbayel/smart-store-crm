import type { OutcomeFormItemState, Product } from '../../../types';
import { outcomeApi } from '../../../api/outcome';
import {
  useHistoricalPurchasePrices,
  type HistoricalPriceFetcher,
} from '../../../hooks/useHistoricalPurchasePrices';

export type { HistoricalPriceStatus } from '../../../hooks/useHistoricalPurchasePrices';

interface UseOutcomeHistoricalPricesOptions {
  isOpen: boolean;
  documentDate: string;
  items: OutcomeFormItemState[];
  activeProducts: Product[];
}

const fetchOutcomePrices: HistoricalPriceFetcher = (productIds, occurredAt, signal) =>
  outcomeApi.fetchHistoricalPurchasePrices(productIds, occurredAt, signal);

/**
 * Historical purchase prices for the outcome form (see useHistoricalPurchasePrices for race protection).
 */
export const useOutcomeHistoricalPrices = (options: UseOutcomeHistoricalPricesOptions) =>
  useHistoricalPurchasePrices({ ...options, fetchPrices: fetchOutcomePrices });
