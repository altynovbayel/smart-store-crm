import type { Product } from './product';
import type { MappedApiError } from './apiError';

export type PaymentMethod = 'cash' | 'card' | 'transfer';
export type PaymentMethodLabel = 'Наличные' | 'Карта' | 'Перевод';

export const PAYMENT_METHODS: Record<PaymentMethod, PaymentMethodLabel> = {
  cash: 'Наличные',
  card: 'Карта',
  transfer: 'Перевод',
};

export type DiscountType = 'fixed' | 'percent';

export const DISCOUNT_TYPES: Record<DiscountType, string> = {
  fixed: 'Фиксированная (сом)',
  percent: 'Процентная (%)',
};

export type SaleStatus = 'completed';
export type SaleStatusLabel = 'Завершено';

export interface SaleItem {
  id: string;
  productId: string;
  productName: string;
  sku: string;
  quantity: number;
  unitPrice: number;
  purchasePriceSnapshot: number;
  grossAmount: number;
  discountType: DiscountType;
  discountValue: number;
  discountAmount: number;
  finalAmount: number;
  costAmount: number;
  profitAmount: number;
  /** Barcode snapshot at the moment of sale (server receipts only). */
  barcode?: string;
  /**
   * Server receipts only: share of the receipt-level discount allocated to this line.
   * `finalAmount` keeps its meaning (after the item discount, BEFORE the receipt discount),
   * so consumers that allocate the receipt discount themselves never subtract it twice.
   */
  receiptDiscountAllocated?: number;
  /** Server receipts only: amount actually paid for the line (finalAmount − receiptDiscountAllocated). */
  netAmount?: number;
}

export interface Sale {
  id: string;
  receiptNumber: string;
  soldAt: string;
  createdAt: string;
  paymentMethod: PaymentMethod;
  paymentMethodLabel: PaymentMethodLabel;
  items: SaleItem[];
  subtotal: number;
  itemDiscountTotal: number;
  receiptDiscountType: DiscountType;
  receiptDiscountValue: number;
  receiptDiscountAmount: number;
  totalAmount: number;
  costAmount: number;
  profitAmount: number;
  receivedAmount?: number;
  changeAmount?: number;
  responsiblePerson: string;
  comment?: string;
  status: SaleStatus;
  statusLabel: SaleStatusLabel;
  // Dashboard & display compatibility
  primaryProductName?: string;
  itemsCount?: number;
  dateTimeFormatted?: string;
}

export type SalePeriodFilter = 'all' | 'today' | 'week' | 'month';

export interface SaleFilters {
  searchQuery: string;
  period: SalePeriodFilter;
  paymentMethod: PaymentMethod | 'all';
}

export interface SaleItemInput {
  productId: string;
  quantity: number;
  unitPrice: number;
  discountType: DiscountType;
  discountValue: number;
}

export interface SaleFormItemState {
  id: string;
  productId: string;
  rawQuantity: string;
  rawUnitPrice: string;
  discountType: DiscountType;
  rawDiscountValue: string;
}

export interface SaleFormData {
  soldAt: string;
  paymentMethod: PaymentMethod;
  receivedAmount?: number;
  responsiblePerson: string;
  comment?: string;
  receiptDiscountType: DiscountType;
  receiptDiscountValue: number;
  items: SaleItemInput[];
}

export interface SaleSummary {
  todayRevenue: number;
  todaySalesCount: number;
  todayAverageCheck: number;
  todayProfit: number;
}

export interface SaleItemCalculations {
  quantity: number;
  unitPrice: number;
  grossAmount: number;
  discountAmount: number;
  finalAmount: number;
  costAmount: number;
  profitAmount: number;
  grossCents: number;
  discountCents: number;
  finalCents: number;
  costCents: number;
  profitCents: number;
}

export interface SaleTotals {
  totalUnits: number;
  subtotal: number;
  itemDiscountTotal: number;
  itemsFinal: number;
  receiptDiscountAmount: number;
  totalAmount: number;
  costAmount: number;
  profitAmount: number;
  changeAmount: number;
  isOverflow: boolean;
}

export interface SaleValidationResult {
  isValid: boolean;
  errors: Record<string, string>;
  data?: SaleFormData;
}

export interface BarcodeScanResult {
  success: boolean;
  product?: Product;
  updatedItems?: SaleFormItemState[];
  message?: string;
  error?: string;
}

/** Discount type as stored by PostgreSQL (`public.discount_type`); the form never uses 'none'. */
export type ServerDiscountType = 'none' | 'fixed' | 'percent';

export type MappedSaleError = MappedApiError;

export type SaleApiResult<T> =
  | { success: true; data: T }
  | { success: false; error: MappedSaleError };

/**
 * Form submission payload: the idempotency UUID is mandatory at this boundary,
 * so a sale can never reach the RPC without a pre-generated key.
 */
export type SaleSubmitPayload = SaleFormData & { id: string };

export type SaleSubmitResult =
  | { success: true }
  | { success: false; error: MappedSaleError; catalogRefreshed?: boolean };

/** Input of salesApi.createSale (amounts in som; converted to minor units by the mapper). */
export interface CreateSaleInput {
  id: string;
  soldAt?: string;
  paymentMethod: PaymentMethod;
  receivedAmount?: number;
  comment?: string;
  receiptDiscountType: DiscountType;
  receiptDiscountValue: number;
  items: SaleItemInput[];
}

export interface CreateSaleResult {
  id: string;
  receiptNumber: string;
  totalAmount: number;
  profitAmount: number;
  changeAmount: number | null;
  itemsCount: number;
}

export interface FetchSalesOptions {
  signal?: AbortSignal;
  /** Safety cap of receipts loaded into memory (default 5000). */
  limit?: number;
  /** Inclusive ISO lower bound for sold_at (future Sales History range queries). */
  soldFrom?: string;
  /** Inclusive ISO upper bound for sold_at. */
  soldTo?: string;
  /**
   * Exclusive ISO upper bound for sold_at (PostgREST `lt`): calendar ranges are loaded
   * as [soldFrom, soldBefore) with soldBefore = start of the day after the last day.
   */
  soldBefore?: string;
}

export interface FetchSalesResult {
  sales: Sale[];
  /** True when the safety limit was reached and older receipts were not loaded. */
  isTruncated: boolean;
  totalFetched: number;
}

export interface PendingSaleOperation {
  id: string;
  userId: string;
  payload: SaleFormData;
  submittedAt: string;
}
