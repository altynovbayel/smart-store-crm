import type {
  Sale,
  SalesHistoryFilters,
  SalesHistorySort,
  SalesHistorySummary,
  SalesHistoryDateRangeErrors,
  SalesHistoryExportRow,
} from '../types';
import { PAYMENT_METHODS } from '../types/sale';
import {
  parseCustomDate,
  isToday,
  isWithinDays,
  formatCalendarDateKey,
} from './dateUtils';
import { toCents, fromCents } from './incomeCalculations';
import { buildCSVContent, downloadCSVFile, type CSVCellValue } from './csvUtils';

/**
 * Validates custom date range selection.
 */
export const validateDateRange = (
  from: string,
  to: string,
  maxDateKey?: string
): SalesHistoryDateRangeErrors => {
  const errors: SalesHistoryDateRangeErrors = {};
  const todayKey = maxDateKey || formatCalendarDateKey(new Date());

  if (from && from > todayKey) {
    errors.from = 'Дата не может быть в будущем';
  }

  if (to && to > todayKey) {
    errors.to = 'Дата не может быть в будущем';
  }

  if (from && to && from > to) {
    errors.from = 'Начальная дата не может быть позже конечной';
  }

  return errors;
};

/**
 * Filters sales history based on search query, payment method, and time period.
 */
export const filterSalesHistory = (
  sales: readonly Sale[],
  filters: SalesHistoryFilters,
  referenceDateKey?: string
): Sale[] => {
  const trimmedSearch = filters.searchQuery.trim().toLowerCase();

  return sales.filter((sale) => {
    // 1. Search Query (receiptNumber, comment, item names, item SKUs)
    if (trimmedSearch) {
      const matchNumber = sale.receiptNumber.toLowerCase().includes(trimmedSearch);
      const matchComment = sale.comment
        ? sale.comment.toLowerCase().includes(trimmedSearch)
        : false;
      const matchItems = sale.items.some(
        (it) =>
          it.productName.toLowerCase().includes(trimmedSearch) ||
          it.sku.toLowerCase().includes(trimmedSearch)
      );

      if (!matchNumber && !matchComment && !matchItems) {
        return false;
      }
    }

    // 2. Payment Method Filter
    if (
      filters.paymentMethod !== 'all' &&
      sale.paymentMethod !== filters.paymentMethod
    ) {
      return false;
    }

    // 3. Period Filter
    if (filters.period === 'today') {
      if (!isToday(sale.soldAt, referenceDateKey)) return false;
    } else if (filters.period === 'week') {
      if (!isWithinDays(sale.soldAt, 7, referenceDateKey)) return false;
    } else if (filters.period === 'month') {
      if (!isWithinDays(sale.soldAt, 30, referenceDateKey)) return false;
    } else if (filters.period === 'custom') {
      const errors = validateDateRange(filters.dateFrom, filters.dateTo, referenceDateKey);
      if (errors.from || errors.to) {
        return false;
      }

      const saleDate = parseCustomDate(sale.soldAt);
      if (!saleDate) return false;

      const saleDateKey = formatCalendarDateKey(saleDate);

      if (filters.dateFrom && saleDateKey < filters.dateFrom) {
        return false;
      }
      if (filters.dateTo && saleDateKey > filters.dateTo) {
        return false;
      }
    }

    return true;
  });
};

/**
 * Calculates total units count for a single sale.
 */
export const getSaleUnitsCount = (sale: Sale): number => {
  if (typeof sale.itemsCount === 'number') {
    return sale.itemsCount;
  }
  return sale.items.reduce((sum, item) => sum + item.quantity, 0);
};

/**
 * Calculates total discount amount for a single sale with safe integer cent arithmetic.
 */
export const getSaleTotalDiscount = (sale: Sale): number => {
  return fromCents(
    toCents(sale.itemDiscountTotal) + toCents(sale.receiptDiscountAmount || 0)
  );
};

/**
 * Sorts sales history array by chosen field and direction with a stable tie-break.
 */
export const sortSalesHistory = (
  sales: readonly Sale[],
  sort: SalesHistorySort
): Sale[] => {
  const { field, direction } = sort;
  const factor = direction === 'asc' ? 1 : -1;

  return [...sales].sort((a, b) => {
    let cmp = 0;

    switch (field) {
      case 'soldAt': {
        const da = parseCustomDate(a.soldAt)?.getTime() ?? 0;
        const db = parseCustomDate(b.soldAt)?.getTime() ?? 0;
        cmp = da - db;
        break;
      }
      case 'receiptNumber': {
        cmp = a.receiptNumber.localeCompare(b.receiptNumber, undefined, {
          numeric: true,
          sensitivity: 'base',
        });
        break;
      }
      case 'unitsCount': {
        const ua = getSaleUnitsCount(a);
        const ub = getSaleUnitsCount(b);
        cmp = ua - ub;
        break;
      }
      case 'totalAmount': {
        cmp = a.totalAmount - b.totalAmount;
        break;
      }
      default:
        cmp = 0;
    }

    if (cmp !== 0) {
      return cmp * factor;
    }

    // Stable tie-break by soldAt desc, then createdAt desc, then id desc
    const da = parseCustomDate(a.soldAt)?.getTime() ?? 0;
    const db = parseCustomDate(b.soldAt)?.getTime() ?? 0;
    if (da !== db) return db - da;

    const ca = parseCustomDate(a.createdAt)?.getTime() ?? 0;
    const cb = parseCustomDate(b.createdAt)?.getTime() ?? 0;
    if (ca !== cb) return cb - ca;

    return b.id.localeCompare(a.id);
  });
};

/**
 * Computes aggregate summary metrics for the given sales list.
 * Safe integer cent arithmetic is used for financial sums.
 */
export const calculateSalesHistorySummary = (
  sales: readonly Sale[]
): SalesHistorySummary => {
  let revenueCents = 0;
  let unitsSold = 0;

  for (const sale of sales) {
    revenueCents += toCents(sale.totalAmount);
    unitsSold += getSaleUnitsCount(sale);
  }

  const receiptsCount = sales.length;
  const averageCheck =
    receiptsCount > 0
      ? fromCents(Math.round(revenueCents / receiptsCount))
      : 0;

  return {
    revenue: fromCents(revenueCents),
    receiptsCount,
    unitsSold,
    averageCheck,
  };
};

/**
 * Builds rows for CSV export.
 */
export const buildSalesHistoryExportRows = (
  sales: readonly Sale[]
): SalesHistoryExportRow[] => {
  return sales.map((sale) => {
    const d = parseCustomDate(sale.soldAt);
    let dateStr = '—';
    let timeStr = '—';

    if (d) {
      const day = String(d.getDate()).padStart(2, '0');
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const year = d.getFullYear();
      const hours = String(d.getHours()).padStart(2, '0');
      const minutes = String(d.getMinutes()).padStart(2, '0');

      dateStr = `${day}.${month}.${year}`;
      timeStr = `${hours}:${minutes}`;
    }

    const totalDiscount = getSaleTotalDiscount(sale);

    return {
      receiptNumber: sale.receiptNumber,
      date: dateStr,
      time: timeStr,
      paymentMethod: PAYMENT_METHODS[sale.paymentMethod] || sale.paymentMethod,
      positionsCount: sale.items.length,
      unitsCount: getSaleUnitsCount(sale),
      subtotal: sale.subtotal,
      totalDiscount,
      totalAmount: sale.totalAmount,
      receivedAmount:
        sale.paymentMethod === 'cash' && typeof sale.receivedAmount === 'number'
          ? sale.receivedAmount
          : null,
      changeAmount:
        sale.paymentMethod === 'cash' && typeof sale.changeAmount === 'number'
          ? sale.changeAmount
          : null,
      status: sale.statusLabel || 'Завершено',
    };
  });
};

/**
 * Generates and triggers download of sales history CSV file.
 */
export const exportSalesHistoryToCSV = (
  sales: readonly Sale[],
  currentDateKey?: string
): void => {
  const headers = [
    '№ чека',
    'Дата',
    'Время',
    'Способ оплаты',
    'Количество позиций',
    'Количество товаров (шт.)',
    'Сумма без скидки',
    'Скидка',
    'Итоговая сумма',
    'Получено',
    'Сдача',
    'Статус',
  ] as const;

  const exportRows = buildSalesHistoryExportRows(sales);
  const rows: CSVCellValue[][] = exportRows.map((r) => [
    r.receiptNumber,
    r.date,
    r.time,
    r.paymentMethod,
    r.positionsCount,
    r.unitsCount,
    r.subtotal,
    r.totalDiscount,
    r.totalAmount,
    r.receivedAmount !== null ? r.receivedAmount : '',
    r.changeAmount !== null ? r.changeAmount : '',
    r.status,
  ]);

  const dateSuffix = currentDateKey || formatCalendarDateKey(new Date());
  const fileName = `smart-store-sales-history-${dateSuffix}.csv`;

  downloadCSVFile(buildCSVContent(headers, rows), fileName);
};
