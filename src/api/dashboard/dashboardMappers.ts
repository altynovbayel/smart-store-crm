import type {
  DashboardDailySales,
  DashboardLowStockProduct,
  DashboardPopularProduct,
  DashboardRecentSale,
  DashboardSalesSummary,
  DashboardStockSummary,
  PaymentMethod,
} from '../../types';
import { PAYMENT_METHODS } from '../../types';
import { parseProductCategory } from '../../utils/productUtils';
import { parseSafeCountString } from '../../utils/dashboardCalculations';
import { DashboardDataError } from './dashboardErrorMapper';

const MALFORMED = 'Сервер вернул некорректные данные показателей. Повторите попытку позже.';
const OVERFLOW = 'Показатель превышает допустимый предел точных вычислений. Данные не отображены.';

type JsonRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const readArray = (obj: JsonRecord, key: string): unknown[] => {
  const value = obj[key];
  if (!Array.isArray(value)) throw new DashboardDataError(MALFORMED);
  return value;
};

const readRecord = (value: unknown): JsonRecord => {
  if (!isRecord(value)) throw new DashboardDataError(MALFORMED);
  return value;
};

const readString = (obj: JsonRecord, key: string): string => {
  const value = obj[key];
  if (typeof value !== 'string') throw new DashboardDataError(MALFORMED);
  return value;
};

/** Exact aggregate sent as a decimal string; BigInt-checked against MAX_SAFE_INTEGER. */
const readCount = (obj: JsonRecord, key: string): number => {
  const raw = obj[key];
  if (typeof raw !== 'string' || !/^(0|[1-9]\d*)$/.test(raw)) throw new DashboardDataError(MALFORMED);
  const value = parseSafeCountString(raw);
  if (value === null) throw new DashboardDataError(OVERFLOW);
  return value;
};

const readSmallInt = (obj: JsonRecord, key: string): number => {
  const value = obj[key];
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new DashboardDataError(MALFORMED);
  return value;
};

const isPaymentMethod = (value: string): value is PaymentMethod => value in PAYMENT_METHODS;

const mapDaily = (value: unknown): DashboardDailySales => {
  const row = readRecord(value);
  const dayStart = readString(row, 'day_start');
  if (Number.isNaN(Date.parse(dayStart))) throw new DashboardDataError(MALFORMED);
  return {
    dayStart,
    revenueMinor: readCount(row, 'revenue_minor'),
    receiptsCount: readCount(row, 'receipts_count'),
  };
};

const mapPopular = (value: unknown): DashboardPopularProduct => {
  const row = readRecord(value);
  return {
    productId: readString(row, 'product_id'),
    name: readString(row, 'name'),
    category: parseProductCategory(readString(row, 'category')),
    categoryLabel: readString(row, 'category_label'),
    units: readCount(row, 'units'),
    revenueMinor: readCount(row, 'revenue_minor'),
  };
};

const mapRecent = (value: unknown): DashboardRecentSale => {
  const row = readRecord(value);
  const paymentMethod = readString(row, 'payment_method');
  if (!isPaymentMethod(paymentMethod)) throw new DashboardDataError(MALFORMED);
  const linesCount = readCount(row, 'lines_count');
  const primaryName = row.primary_product_name;
  return {
    id: readString(row, 'id'),
    receiptNumber: readString(row, 'receipt_number'),
    soldAt: readString(row, 'sold_at'),
    paymentMethod,
    paymentMethodLabel: PAYMENT_METHODS[paymentMethod],
    statusLabel: readString(row, 'status') === 'completed' ? 'Завершено' : readString(row, 'status'),
    totalMinor: readCount(row, 'total_minor'),
    unitsCount: readCount(row, 'items_count'),
    primaryProductName: typeof primaryName === 'string' ? primaryName : '',
    otherLinesCount: Math.max(0, linesCount - 1),
  };
};

/**
 * Parses rpc_get_dashboard_sales_summary. The daily series must contain exactly one row per
 * requested interval and its starts must equal the requested bounds (no silent gaps or shifts).
 */
export const mapDashboardSalesSummary = (
  data: unknown,
  requestedBounds: readonly string[]
): DashboardSalesSummary => {
  const root = readRecord(data);
  const dailySales = readArray(root, 'daily_sales').map(mapDaily);

  if (dailySales.length !== requestedBounds.length - 1) throw new DashboardDataError(MALFORMED);
  dailySales.forEach((day, i) => {
    if (Date.parse(day.dayStart) !== Date.parse(requestedBounds[i])) {
      throw new DashboardDataError(MALFORMED);
    }
  });

  return {
    dailySales,
    popularProducts: readArray(root, 'popular_products').map(mapPopular),
    recentSales: readArray(root, 'recent_sales').map(mapRecent),
  };
};

const mapLowStock = (value: unknown): DashboardLowStockProduct => {
  const row = readRecord(value);
  const status = readString(row, 'status');
  if (status !== 'low_stock' && status !== 'out_of_stock') throw new DashboardDataError(MALFORMED);
  return {
    id: readString(row, 'id'),
    sku: readString(row, 'sku'),
    name: readString(row, 'name'),
    category: parseProductCategory(readString(row, 'category')),
    categoryLabel: readString(row, 'category_label'),
    stock: readSmallInt(row, 'stock'),
    minStockThreshold: readSmallInt(row, 'min_stock_threshold'),
    status,
  };
};

/** Parses rpc_get_dashboard_stock_summary. */
export const mapDashboardStockSummary = (data: unknown): DashboardStockSummary => {
  const root = readRecord(data);
  const totals = readRecord(root.stock_summary);
  return {
    totals: {
      totalUnits: readCount(totals, 'total_units'),
      activeProductsCount: readCount(totals, 'active_products_count'),
      problemProductsCount: readCount(totals, 'problem_products_count'),
    },
    lowStockProducts: readArray(root, 'low_stock_products').map(mapLowStock),
  };
};
