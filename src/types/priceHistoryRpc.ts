import type { Database } from './database.types';

/**
 * Raw JSON contract of rpc_get_purchase_prices_at (migration 20261020140000_rbac_purchase_price_history_rpc).
 * Admin only: any other caller gets 42501 and no data. One item per distinct requested product,
 * ordered by product_id; resolution matches rpc_create_outcome_document exactly.
 * Monetary values are integer tyiyns (bigint serialized as a JSON number);
 * timestamps are PostgreSQL timestamptz strings with microsecond precision.
 */

export type GetPurchasePricesAtRpcArgs =
  Database['public']['Functions']['rpc_get_purchase_prices_at']['Args'];

export type PurchasePriceRpcSource = 'exact_history' | 'earliest_history' | 'catalog_fallback';

interface PurchasePriceRpcItemBase {
  product_id: string;
  purchase_price_minor: number;
}

/** Price taken from product_price_history; effective_from of the chosen point. */
export interface PurchasePriceRpcHistoryItem extends PurchasePriceRpcItemBase {
  source: 'exact_history' | 'earliest_history';
  effective_from: string;
}

/** No history for the product: current products.purchase_price_minor. */
export interface PurchasePriceRpcCatalogItem extends PurchasePriceRpcItemBase {
  source: 'catalog_fallback';
  effective_from: null;
}

export type PurchasePriceRpcItemRaw = PurchasePriceRpcHistoryItem | PurchasePriceRpcCatalogItem;

export interface GetPurchasePricesAtRpcResponseRaw {
  /** Echo of p_occurred_at (for stale-response checks). */
  occurred_at: string;
  items: PurchasePriceRpcItemRaw[];
}

/** Server limit of distinct product ids per rpc_get_purchase_prices_at call. */
export const PURCHASE_PRICES_RPC_MAX_PRODUCTS = 500;
