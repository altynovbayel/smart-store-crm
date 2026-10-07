import type { Product } from './product';

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
