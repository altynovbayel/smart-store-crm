import type { Sale, SaleFilters, SaleSummary } from '../types';
import { isToday, isWithinDays, parseCustomDate } from './dateUtils';
import { toCents, fromCents } from './incomeCalculations';

/**
 * "Today" statistics of the sales page computed in integer cents.
 * Profit is computed only when `includeProfit` (admin) and every receipt of today has server cost data;
 * otherwise it is null (never 0 or a partial sum).
 */
export const calculateSalesSummaryStats = (
  sales: readonly Sale[],
  currentDateKey: string,
  includeProfit: boolean
): SaleSummary => {
  let todayRevenueCents = 0;
  let todaySalesCount = 0;
  let todayProfitCents = 0;
  // Profit is shown only if EVERY receipt of today carries server cost data (never a partial sum)
  let isProfitComplete = includeProfit;

  for (const s of sales) {
    if (isToday(s.soldAt, currentDateKey)) {
      todayRevenueCents += toCents(s.totalAmount);
      todaySalesCount += 1;
      if (isProfitComplete) {
        if (s.profitAmount === null) {
          isProfitComplete = false;
        } else {
          todayProfitCents += toCents(s.profitAmount);
        }
      }
    }
  }

  const todayAverageCheck =
    todaySalesCount > 0 ? fromCents(Math.round(todayRevenueCents / todaySalesCount)) : 0;

  return {
    todayRevenue: fromCents(todayRevenueCents),
    todaySalesCount,
    todayAverageCheck,
    todayProfit: isProfitComplete ? fromCents(todayProfitCents) : null,
  };
};

/**
 * Filters receipts by search query (number, comment, line names / SKUs), payment method and period,
 * sorted by sold_at DESC, created_at DESC, id DESC.
 */
export const filterSales = (
  sales: readonly Sale[],
  filters: SaleFilters,
  currentDateKey: string
): Sale[] =>
  sales
    .filter((s) => {
      if (filters.searchQuery.trim()) {
        const q = filters.searchQuery.trim().toLowerCase();
        const matchNumber = s.receiptNumber.toLowerCase().includes(q);
        const matchComment = s.comment ? s.comment.toLowerCase().includes(q) : false;
        const matchItems = s.items.some(
          (it) => it.productName.toLowerCase().includes(q) || it.sku.toLowerCase().includes(q)
        );
        if (!matchNumber && !matchComment && !matchItems) {
          return false;
        }
      }

      if (filters.paymentMethod !== 'all' && s.paymentMethod !== filters.paymentMethod) {
        return false;
      }

      if (filters.period === 'today') {
        if (!isToday(s.soldAt, currentDateKey)) return false;
      } else if (filters.period === 'week') {
        if (!isWithinDays(s.soldAt, 7, currentDateKey)) return false;
      } else if (filters.period === 'month') {
        if (!isWithinDays(s.soldAt, 30, currentDateKey)) return false;
      }

      return true;
    })
    .sort((a, b) => {
      const da = parseCustomDate(a.soldAt)?.getTime() ?? 0;
      const db = parseCustomDate(b.soldAt)?.getTime() ?? 0;
      if (da !== db) return db - da;
      const ca = parseCustomDate(a.createdAt)?.getTime() ?? 0;
      const cb = parseCustomDate(b.createdAt)?.getTime() ?? 0;
      if (ca !== cb) return cb - ca;
      return b.id.localeCompare(a.id);
    });
