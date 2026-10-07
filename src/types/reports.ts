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
