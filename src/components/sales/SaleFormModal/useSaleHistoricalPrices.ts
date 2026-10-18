import type { Product, SaleFormItemState } from '../../../types';
import { salesApi } from '../../../api/sales';
import {
  useHistoricalPurchasePrices,
  type HistoricalPriceFetcher,
} from '../../../hooks/useHistoricalPurchasePrices';

interface UseSaleHistoricalPricesOptions {
  isOpen: boolean;
  soldAt: string;
  items: SaleFormItemState[];
  activeProducts: Product[];
}

const fetchSalePrices: HistoricalPriceFetcher = (productIds, occurredAt, activeProducts, signal) =>
  salesApi.fetchHistoricalPurchasePrices(productIds, occurredAt, activeProducts, signal);

/**
 * Historical purchase prices at the sale date (same resolution and race protection as Outcome).
 * Used only for cost bounds / preview; the server takes the authoritative cost snapshot.
 */
export const useSaleHistoricalPrices = ({ soldAt, ...rest }: UseSaleHistoricalPricesOptions) =>
  useHistoricalPurchasePrices({ ...rest, documentDate: soldAt, fetchPrices: fetchSalePrices });
