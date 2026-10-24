import type {
  DashboardDailySales,
  DashboardLowStockProduct,
  DashboardMetric,
  DashboardPopularProduct,
  DashboardRecentSale,
  DashboardRecentSaleRow,
  DashboardStockTotals,
  LowStockItem,
  PopularProductItem,
  RevenueDataPoint,
} from '../types';
import { localDayStartIso } from './salesHistoryRange';
import { getIconTypeByCategory } from './productUtils';
import { formatCurrency, formatNumber } from './formatUtils';
import { formatDateTime } from './dateUtils';

/** Number of local calendar days covered by the Dashboard sales summary (chart max period). */
export const DASHBOARD_DAYS = 30;

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const DECIMAL_STRING = /^(0|[1-9]\d*)$/;

/**
 * Strictly parses a non-negative decimal string (exact PostgreSQL aggregate) with BigInt.
 * Returns null for malformed input or values above Number.MAX_SAFE_INTEGER — never a lossy number.
 */
export const parseSafeCountString = (value: unknown): number | null => {
  if (typeof value !== 'string' || !DECIMAL_STRING.test(value)) return null;
  const big = BigInt(value);
  return big <= MAX_SAFE ? Number(big) : null;
};

/** Tyiyns → som for DISPLAY only (all sums are computed in integer tyiyns). */
export const minorToDisplayAmount = (minor: number): number => minor / 100;

/**
 * DASHBOARD_DAYS + 1 strictly increasing LOCAL midnights: start of (today − 29) … start of tomorrow.
 * Built from calendar components (new Date(y, m, d + offset)), never by adding 24 h, so DST days
 * (23 h / 25 h) keep exact midnights. Returns null for a malformed date key.
 */
export const buildDashboardDayBounds = (currentDateKey: string): string[] | null => {
  const bounds: string[] = [];
  for (let offset = -(DASHBOARD_DAYS - 1); offset <= 1; offset++) {
    const bound = localDayStartIso(currentDateKey, offset);
    if (!bound) return null;
    bounds.push(bound);
  }
  return bounds;
};

/** Local calendar date (YYYY-MM-DD, label parts) of the day `offset` days from the reference key. */
const localDayParts = (currentDateKey: string, offset: number) => {
  const iso = localDayStartIso(currentDateKey, offset);
  const d = iso ? new Date(iso) : new Date();
  return { year: d.getFullYear(), month: d.getMonth(), day: d.getDate() };
};

const MONTH_NAMES_SHORT = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const MONTH_NAMES_FULL = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
];

/**
 * Revenue chart points for the last `days` days (7 / 14 / 30) from the single 30-day series.
 * The series is ordered oldest → newest and its last element is "today".
 */
export const buildRevenueChartPoints = (
  dailySales: readonly DashboardDailySales[],
  days: number,
  currentDateKey: string
): RevenueDataPoint[] => {
  const slice = dailySales.slice(Math.max(0, dailySales.length - days));
  return slice.map((point, index) => {
    const offset = index - (slice.length - 1);
    const { year, month, day } = localDayParts(currentDateKey, offset);
    const revenue = minorToDisplayAmount(point.revenueMinor);
    return {
      date: `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
      label: `${day} ${MONTH_NAMES_SHORT[month]}`,
      revenue,
      formattedRevenue: `${revenue.toLocaleString('ru-RU')} сом`,
      fullDate: `${day} ${MONTH_NAMES_FULL[month]} ${year}`,
    };
  });
};

/**
 * Integer percent change with Math.round semantics (half toward +∞), computed with BigInt so
 * large tyiyn sums never lose precision. Returns null when the previous value is 0.
 */
export const calculateTrendPercent = (current: number, previous: number): number | null => {
  if (previous <= 0) return null;
  const numerator = (BigInt(current) - BigInt(previous)) * 100n;
  const denominator = BigInt(previous);
  // round(n / d) = floor((2n + d) / 2d) for d > 0
  const twice = numerator * 2n + denominator;
  const divisor = denominator * 2n;
  const floor = twice >= 0n ? twice / divisor : -((-twice + divisor - 1n) / divisor);
  return Number(floor);
};

type TrendType = DashboardMetric['trendType'];

const describeTrend = (
  current: number,
  previous: number,
  growthFromZeroText: string
): { text: string; type: TrendType } => {
  const pct = calculateTrendPercent(current, previous);
  if (pct === null) {
    return current > 0
      ? { text: growthFromZeroText, type: 'positive' }
      : { text: 'Нет данных за вчера', type: 'neutral' };
  }
  if (pct > 0) return { text: `+${pct}% к вчерашнему дню`, type: 'positive' };
  if (pct < 0) return { text: `${pct}% к вчерашнему дню`, type: 'negative' };
  return { text: '0% к вчерашнему дню', type: 'neutral' };
};

/** "Today" and "yesterday" are the last two intervals of the 30-day series. */
export const getTodayAndYesterday = (dailySales: readonly DashboardDailySales[]) => {
  const zero: DashboardDailySales = { dayStart: '', revenueMinor: 0, receiptsCount: 0 };
  return {
    today: dailySales[dailySales.length - 1] ?? zero,
    yesterday: dailySales[dailySales.length - 2] ?? zero,
  };
};

const PLACEHOLDER_VALUE = '—';

/** Revenue and receipts cards. `state` drives loading / error placeholders. */
export const buildSalesMetricCards = (
  dailySales: readonly DashboardDailySales[] | null,
  state: 'loading' | 'error' | 'ready'
): DashboardMetric[] => {
  if (!dailySales || state !== 'ready') {
    const text = state === 'error' ? 'Данные о продажах недоступны' : 'Загрузка...';
    const type: TrendType = state === 'error' ? 'negative' : 'neutral';
    return [
      { id: 'revenue', title: 'Выручка сегодня', value: PLACEHOLDER_VALUE, trendText: text, trendType: type, icon: 'revenue' },
      { id: 'sales', title: 'Продажи сегодня', value: PLACEHOLDER_VALUE, trendText: text, trendType: type, icon: 'sales' },
    ];
  }

  const { today, yesterday } = getTodayAndYesterday(dailySales);
  const revenueTrend = describeTrend(today.revenueMinor, yesterday.revenueMinor, 'Рост с 0 сом вчера');
  const salesTrend = describeTrend(today.receiptsCount, yesterday.receiptsCount, 'Первые чеки за день');

  return [
    {
      id: 'revenue',
      title: 'Выручка сегодня',
      value: formatCurrency(minorToDisplayAmount(today.revenueMinor)),
      trendText: revenueTrend.text,
      trendType: revenueTrend.type,
      icon: 'revenue',
    },
    {
      id: 'sales',
      title: 'Продажи сегодня',
      value: formatNumber(today.receiptsCount),
      trendText: salesTrend.text,
      trendType: salesTrend.type,
      icon: 'sales',
    },
  ];
};

/** Warehouse and low-stock cards computed over ALL active products by the server. */
export const buildStockMetricCards = (
  totals: DashboardStockTotals | null,
  state: 'loading' | 'error' | 'ready'
): DashboardMetric[] => {
  if (!totals || state !== 'ready') {
    const text = state === 'error' ? 'Данные склада недоступны' : 'Загрузка...';
    const type: TrendType = state === 'error' ? 'negative' : 'neutral';
    return [
      { id: 'warehouse', title: 'Товаров на складе', value: PLACEHOLDER_VALUE, trendText: text, trendType: type, icon: 'warehouse' },
      { id: 'alert', title: 'Заканчиваются', value: PLACEHOLDER_VALUE, trendText: text, trendType: type, icon: 'alert' },
    ];
  }

  return [
    {
      id: 'warehouse',
      title: 'Товаров на складе',
      value: `${formatNumber(totals.totalUnits)} шт.`,
      trendText: `${totals.activeProductsCount} наименований`,
      trendType: 'positive',
      icon: 'warehouse',
    },
    {
      id: 'alert',
      title: 'Заканчиваются',
      value: String(totals.problemProductsCount),
      trendText: totals.problemProductsCount > 0 ? 'Требуется закупка' : 'Все остатки в норме',
      trendType: totals.problemProductsCount > 0 ? 'negative' : 'positive',
      icon: 'alert',
    },
  ];
};

/** Ranked popular products (server order: units DESC, revenue DESC, product id). */
export const buildPopularProductItems = (
  products: readonly DashboardPopularProduct[]
): PopularProductItem[] =>
  products.map((p, index) => ({
    id: p.productId,
    rank: index + 1,
    name: p.name,
    categoryLabel: p.categoryLabel,
    salesCount: p.units,
    totalRevenue: minorToDisplayAmount(p.revenueMinor),
    iconType: getIconTypeByCategory(p.category),
  }));

/** RecentSales rows: formatted local sold_at and "first line +N other lines". */
export const buildRecentSaleRows = (sales: readonly DashboardRecentSale[]): DashboardRecentSaleRow[] =>
  sales.map((s) => ({
    id: s.id,
    receiptNumber: s.receiptNumber,
    dateTimeFormatted: formatDateTime(s.soldAt),
    productLabel:
      s.otherLinesCount > 0
        ? `${s.primaryProductName || 'Товар'} +${s.otherLinesCount}`
        : s.primaryProductName || '—',
    unitsCount: s.unitsCount,
    totalAmount: minorToDisplayAmount(s.totalMinor),
    paymentMethodLabel: s.paymentMethodLabel,
    statusLabel: s.statusLabel,
  }));

/** LowStock rows (already sorted and limited by the server). */
export const buildLowStockItems = (products: readonly DashboardLowStockProduct[]): LowStockItem[] =>
  products.map((p) => ({
    id: p.id,
    name: p.name,
    stock: p.stock,
    threshold: p.minStockThreshold,
    statusLabel: p.status === 'out_of_stock' ? 'Нет в наличии' : 'Мало',
    severity: p.status === 'out_of_stock' ? 'critical' : 'warning',
  }));
