import type { Database } from './database.types';

/**
 * Raw JSON contracts of the role-aware sales RPCs (migration 20261020100000_rbac_sales_read_rpcs).
 * Field sets are exact per role: a cashier payload never contains profit_minor, cost_total_minor
 * or purchase_price_snapshot_minor — parsers must reject unexpected keys instead of assuming them.
 * Monetary values are integer tyiyns (bigint columns serialized as JSON numbers);
 * timestamps are PostgreSQL timestamptz strings with microsecond precision.
 */

type Functions = Database['public']['Functions'];
type Enums = Database['public']['Enums'];

export type ListSalesRpcArgs = Functions['rpc_list_sales']['Args'];
export type GetSaleRpcArgs = Functions['rpc_get_sale']['Args'];

export type SalesRpcRole = 'admin' | 'cashier';

/** Sale line visible to every active staff member. */
export interface SaleLineRpcRawBase {
  id: string;
  product_id: string;
  product_name_snapshot: string;
  sku_snapshot: string;
  barcode_snapshot: string | null;
  quantity: number;
  selling_price_snapshot_minor: number;
  discount_type: Enums['discount_type'];
  discount_value: number;
  gross_minor: number;
  item_discount_minor: number;
  receipt_discount_allocated_minor: number;
  net_total_minor: number;
  created_at: string;
}

/** Admin-only line fields. */
export interface SaleLineRpcRawAdmin extends SaleLineRpcRawBase {
  purchase_price_snapshot_minor: number;
  cost_total_minor: number;
  profit_minor: number;
}

/** Receipt header visible to every active staff member. */
interface SaleRpcRawHeader {
  id: string;
  receipt_number: string;
  sold_at: string;
  created_at: string;
  payment_method: Enums['payment_method'];
  status: Enums['document_status'];
  subtotal_minor: number;
  item_discount_total_minor: number;
  receipt_discount_type: Enums['discount_type'];
  receipt_discount_value: number;
  receipt_discount_minor: number;
  total_discount_minor: number;
  total_minor: number;
  received_minor: number | null;
  change_minor: number | null;
  comment: string | null;
  created_by_name: string;
}

export interface SaleRpcRawCashier extends SaleRpcRawHeader {
  items: SaleLineRpcRawBase[];
}

export interface SaleRpcRawAdmin extends SaleRpcRawHeader {
  profit_minor: number;
  items: SaleLineRpcRawAdmin[];
}

/** Keyset cursor exactly as returned by the server; pass the strings back unchanged. */
export interface SalesRpcCursorRaw {
  sold_at: string;
  created_at: string;
  id: string;
}

export type ListSalesRpcResponseRaw =
  | { role: 'admin'; rows: SaleRpcRawAdmin[]; next_cursor: SalesRpcCursorRaw | null }
  | { role: 'cashier'; rows: SaleRpcRawCashier[]; next_cursor: SalesRpcCursorRaw | null };

export type GetSaleRpcResponseRaw =
  | { role: 'admin'; sale: SaleRpcRawAdmin | null }
  | { role: 'cashier'; sale: SaleRpcRawCashier | null };

/** rpc_create_sale response; profit_minor is present for admins only. */
export interface CreateSaleRpcResponseRaw {
  id: string;
  receipt_number: string;
  total_minor: number;
  change_minor: number | null;
  items_count: number;
  profit_minor?: number;
}

/** Server limits of rpc_list_sales. */
export const SALES_RPC_MAX_PAGE_SIZE = 200;
