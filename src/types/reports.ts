import type { PaymentMethod, PaymentMethodLabel } from './sale';
import type { ProductCategory, StockStatus } from './product';

export type ReportTab = 'sales' | 'warehouse';

export type ReportPeriod = 'today' | 'week' | 'month' | 'custom';

export const REPORT_PERIODS: Record<ReportPeriod, string> = {
  today: 'Сегодня',
  week: 'За 7 дней',
  month: 'За 30 дней',
  custom: 'Произвольный период',
};

export interface ReportDateRange {
  from: string;
  to: string;
}

export interface EffectiveReportDateRange {
  fromKey: string;
  toKey: string;
}

export interface ReportDateRangeErrors {
  from?: string;
  to?: string;
}

export interface SalesReportSummary {
  revenue: number;
  receiptsCount: number;
  unitsSold: number;
  averageCheck: number;
  totalDiscount: number;
  grossProfit: number | null;
  isGrossProfitAvailable: boolean;
}

export interface DailySalesRevenuePoint {
  date: string; // YYYY-MM-DD
  label: string; // DD.MM
  fullDate: string; // DD.MM.YYYY
  revenue: number;
  receiptsCount: number;
  unitsSold: number;
  averageCheck: number;
  totalDiscount: number;
  cashAmount: number;
  cardAmount: number;
  transferAmount: number;
}

export interface PaymentReportItem {
  method: PaymentMethod;
  label: PaymentMethodLabel;
  amount: number;
  receiptsCount: number;
  percentage: number;
}

export interface ProductSalesReportItem {
  rank: number;
  productId: string;
  productName: string;
  sku: string;
  unitsSold: number;
  revenue: number;
  revenueShare: number;
}

export interface WarehouseReportSummary {
  activePositionsCount: number;
  totalUnitsInStock: number;
  totalPurchaseValue: number;
  totalPotentialRevenue: number;
  potentialProfit: number;
  attentionItemsCount: number;
  isOverflow?: boolean;
}

export interface CategoryStockReportItem {
  category: ProductCategory;
  categoryLabel: string;
  positionsCount: number;
  totalUnits: number;
  purchaseValue: number;
  potentialRevenue: number;
}

export interface StockStatusReportItem {
  status: StockStatus;
  label: string;
  count: number;
  percentage: number;
}

export interface AttentionProductItem {
  id: string;
  name: string;
  sku: string;
  category: ProductCategory;
  categoryLabel: string;
  stock: number;
  minStockThreshold: number;
  unit: string;
  purchasePrice: number;
  stockPurchaseValue: number;
  status: StockStatus;
  severity: 'critical' | 'warning';
}

// ---------------------------------------------------------------------------
// Server (raw) contracts of the admin-only Reports RPCs (migration 20261018180000).
// Money sums, price × stock products and counters are exact decimal STRINGS:
// unsigned /^(0|[1-9]\d*)$/, signed (profit) /^-?(0|[1-9]\d*)$/ — parse with BigInt.
// ---------------------------------------------------------------------------

/** Arguments of public.rpc_get_sales_report: 2..367 strictly increasing local-midnight bounds. */
export interface SalesReportRpcArgs {
  p_day_bounds: string[];
  p_top_limit?: number;
}

/** Arguments of public.rpc_get_warehouse_report (attention limit 1..200, default 50). */
export interface WarehouseReportRpcArgs {
  p_attention_limit?: number;
}

/** Arguments of public.rpc_get_warehouse_report_export (page size 1..1000). */
export interface WarehouseReportExportRpcArgs {
  /** NULL on the first page; then the snapshot_at returned by the first page. */
  p_snapshot_at?: string;
  /** Keyset cursor: next_after_id of the previous page. */
  p_after_id?: string;
  p_limit?: number;
}

export interface SalesReportRawSummary {
  revenue_minor: string;
  receipts_count: string;
  units_sold: string;
  total_discount_minor: string;
  /** Signed. */
  gross_profit_minor: string;
}

export interface SalesReportRawDay {
  day_start: string;
  revenue_minor: string;
  receipts_count: string;
  units_sold: string;
  total_discount_minor: string;
  cash_minor: string;
  card_minor: string;
  transfer_minor: string;
}

export interface SalesReportRawPayment {
  method: PaymentMethod;
  amount_minor: string;
  receipts_count: string;
}

export interface SalesReportRawPopularProduct {
  product_id: string;
  name: string;
  sku: string;
  units: string;
  revenue_minor: string;
}

export interface SalesReportRawResponse {
  summary: SalesReportRawSummary;
  /** Exactly p_day_bounds.length − 1 rows, intervals [bound[i], bound[i + 1]). */
  daily: SalesReportRawDay[];
  /** Always cash, card, transfer (zeros included). */
  payments: SalesReportRawPayment[];
  popular_products: SalesReportRawPopularProduct[];
}

export interface WarehouseReportRawSummary {
  active_positions_count: string;
  total_units: string;
  purchase_value_minor: string;
  potential_revenue_minor: string;
  /** Signed. */
  potential_profit_minor: string;
  attention_count: string;
}

export interface WarehouseReportRawCategory {
  /** Raw stored key (may be unknown / legacy → mapped to 'other' by the client). */
  category: string;
  positions_count: string;
  total_units: string;
  purchase_value_minor: string;
  potential_revenue_minor: string;
}

export interface WarehouseReportRawStatuses {
  in_stock: string;
  low_stock: string;
  out_of_stock: string;
}

export interface WarehouseReportRawAttentionItem {
  id: string;
  name: string;
  sku: string;
  category: string;
  category_label: string;
  stock: number;
  min_stock_threshold: number;
  purchase_price_minor: string;
  stock_purchase_value_minor: string;
  status: 'low_stock' | 'out_of_stock';
}

export interface WarehouseReportRawResponse {
  summary: WarehouseReportRawSummary;
  categories: WarehouseReportRawCategory[];
  statuses: WarehouseReportRawStatuses;
  attention: WarehouseReportRawAttentionItem[];
}

export interface WarehouseReportExportRawRow {
  id: string;
  sku: string;
  barcode: string;
  name: string;
  category: string;
  category_label: string;
  purchase_price_minor: string;
  selling_price_minor: string;
  stock: number;
  min_stock_threshold: number;
  purchase_value_minor: string;
  potential_revenue_minor: string;
  status: StockStatus;
}

export interface WarehouseReportExportRawPage {
  /** Server time fixed by the first page; must be passed to every next page. */
  snapshot_at: string;
  /** Ordered by id ASC; at most p_limit rows. */
  rows: WarehouseReportExportRawRow[];
  /** Cursor for the next page, or null when the export is complete. */
  next_after_id: string | null;
}

// ---------------------------------------------------------------------------
// Parsed client models of the Reports RPCs (adapted to the existing report components).
// ---------------------------------------------------------------------------

/** Sales report for one validated period (all amounts already checked against MAX_SAFE_INTEGER). */
export interface SalesReportData {
  summary: SalesReportSummary;
  /** Exactly one point per requested day, same order as the requested bounds. */
  daily: DailySalesRevenuePoint[];
  /** Always cash, card, transfer. */
  payments: PaymentReportItem[];
  popularProducts: ProductSalesReportItem[];
}

/** Warehouse report over all active products. */
export interface WarehouseReportData {
  summary: WarehouseReportSummary;
  /** All 17 predefined categories (zeros included, unknown keys merged into 'other'). */
  categories: CategoryStockReportItem[];
  statuses: StockStatusReportItem[];
  /** First N most critical products (server limit). */
  attention: AttentionProductItem[];
  /** Total number of products requiring attention (M in "Показаны N из M"). */
  attentionTotal: number;
}

/** One parsed warehouse CSV row (amounts in safe integer tyiyns). */
export interface WarehouseExportRow {
  id: string;
  sku: string;
  barcode: string;
  name: string;
  categoryLabel: string;
  purchasePriceMinor: number;
  sellingPriceMinor: number;
  stock: number;
  minStockThreshold: number;
  purchaseValueMinor: number;
  potentialRevenueMinor: number;
  status: StockStatus;
}

export interface WarehouseExportPage {
  snapshotAt: string;
  rows: WarehouseExportRow[];
  nextAfterId: string | null;
}
