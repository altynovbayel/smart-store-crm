import type { MappedApiError } from './apiError';
import type { PaymentMethod, PaymentMethodLabel } from './sale';
import type { ProductCategory } from './product';

/** Arguments of public.rpc_get_dashboard_sales_summary. */
export interface DashboardSalesSummaryArgs {
  /** Strictly increasing local-midnight bounds (ISO): N + 1 bounds form N intervals [from, before). */
  p_day_bounds: string[];
  p_popular_limit?: number;
  p_recent_limit?: number;
}

/** Arguments of public.rpc_get_dashboard_stock_summary. */
export interface DashboardStockSummaryArgs {
  p_low_stock_limit?: number;
}

/**
 * Raw JSON returned by the RPCs. Aggregated minor-unit sums and counters arrive as decimal
 * STRINGS (exact PostgreSQL numeric/bigint); they are parsed with BigInt by the mapper.
 */
export interface DashboardRawDailySales {
  day_start: string;
  revenue_minor: string;
  receipts_count: string;
}

export interface DashboardRawPopularProduct {
  product_id: string;
  name: string;
  category: string;
  category_label: string;
  units: string;
  revenue_minor: string;
}

export interface DashboardRawRecentSale {
  id: string;
  receipt_number: string;
  sold_at: string;
  payment_method: PaymentMethod;
  status: string;
  total_minor: string;
  items_count: string;
  lines_count: string;
  primary_product_name: string | null;
}

export interface DashboardRawStockSummary {
  total_units: string;
  active_products_count: string;
  problem_products_count: string;
}

export interface DashboardRawLowStockProduct {
  id: string;
  sku: string;
  name: string;
  category: string;
  category_label: string;
  stock: number;
  min_stock_threshold: number;
  status: DashboardLowStockStatus;
}

/** One local calendar day of sales (safe integer tyiyns). */
export interface DashboardDailySales {
  dayStart: string;
  revenueMinor: number;
  receiptsCount: number;
}

export interface DashboardPopularProduct {
  productId: string;
  name: string;
  category: ProductCategory;
  categoryLabel: string;
  units: number;
  /** Σ sale_items.net_total_minor (receipt discount already allocated by the server). */
  revenueMinor: number;
}

/** Safe receipt DTO for the Dashboard: no cost, purchase price or profit. */
export interface DashboardRecentSale {
  id: string;
  receiptNumber: string;
  soldAt: string;
  paymentMethod: PaymentMethod;
  paymentMethodLabel: PaymentMethodLabel;
  statusLabel: string;
  totalMinor: number;
  /** Σ quantity of all lines. */
  unitsCount: number;
  primaryProductName: string;
  /** Number of lines besides the first one ("Товар +N"). */
  otherLinesCount: number;
}

export interface DashboardSalesSummary {
  dailySales: DashboardDailySales[];
  popularProducts: DashboardPopularProduct[];
  recentSales: DashboardRecentSale[];
}

export type DashboardLowStockStatus = 'low_stock' | 'out_of_stock';

export interface DashboardStockTotals {
  totalUnits: number;
  activeProductsCount: number;
  problemProductsCount: number;
}

export interface DashboardLowStockProduct {
  id: string;
  sku: string;
  name: string;
  category: ProductCategory;
  categoryLabel: string;
  stock: number;
  minStockThreshold: number;
  status: DashboardLowStockStatus;
}

export interface DashboardStockSummary {
  totals: DashboardStockTotals;
  lowStockProducts: DashboardLowStockProduct[];
}

export type DashboardApiResult<T> =
  | { success: true; data: T }
  | { success: false; error: MappedApiError };

/** Display model of a RecentSales table row. */
export interface DashboardRecentSaleRow {
  id: string;
  receiptNumber: string;
  dateTimeFormatted: string;
  productLabel: string;
  unitsCount: number;
  totalAmount: number;
  paymentMethodLabel: string;
  statusLabel: string;
}

/** Loading state of one independent Dashboard data source. */
export interface DashboardSourceState<T> {
  data: T | null;
  isLoading: boolean;
  error: string | null;
}
