import type { PaymentMethod } from './sale';
import type { SortDirection } from './product';

export type SalesHistoryPeriod = 'all' | 'today' | 'week' | 'month' | 'custom';

export const SALES_HISTORY_PERIODS: Record<SalesHistoryPeriod, string> = {
  all: 'Все',
  today: 'Сегодня',
  week: 'За 7 дней',
  month: 'За 30 дней',
  custom: 'Произвольный период',
};

export interface SalesHistoryFilters {
  searchQuery: string;
  period: SalesHistoryPeriod;
  paymentMethod: PaymentMethod | 'all';
  /** Applied custom range start, local calendar date YYYY-MM-DD or '' */
  dateFrom: string;
  /** Applied custom range end, local calendar date YYYY-MM-DD or '' */
  dateTo: string;
}

export interface SalesHistoryDateRangeDraft {
  from: string;
  to: string;
}

export interface SalesHistoryDateRangeErrors {
  from?: string;
  to?: string;
}

export interface SalesHistorySummary {
  revenue: number;
  receiptsCount: number;
  unitsSold: number;
  averageCheck: number;
}

export type SalesHistorySortField =
  | 'soldAt'
  | 'receiptNumber'
  | 'unitsCount'
  | 'totalAmount';

export interface SalesHistorySort {
  field: SalesHistorySortField;
  direction: SortDirection;
}

export interface SalesHistoryExportRow {
  receiptNumber: string;
  date: string;
  time: string;
  paymentMethod: string;
  positionsCount: number;
  unitsCount: number;
  subtotal: number;
  totalDiscount: number;
  totalAmount: number;
  receivedAmount: number | null;
  changeAmount: number | null;
  status: string;
}

export type CSVCellValue = string | number | undefined | null;

