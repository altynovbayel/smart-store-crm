import type {
  AttentionProductItem,
  CategoryStockReportItem,
  DailySalesRevenuePoint,
  PaymentMethod,
  PaymentReportItem,
  ProductCategory,
  ProductSalesReportItem,
  SalesReportData,
  StockStatus,
  StockStatusReportItem,
  WarehouseExportPage,
  WarehouseExportRow,
  WarehouseReportData,
} from '../../types';
import { PAYMENT_METHODS } from '../../types';
import { getCategoryLabel, getStockStatusLabel, parseProductCategory, PRODUCT_CATEGORY_KEYS } from '../../utils/productUtils';
import {
  calculateAverageMinor,
  calculateShareTenths,
  minorToAmount,
  parseSignedDecimal,
  parseUnsignedDecimal,
} from '../../utils/reportCalculations';
import { isValidUuid } from '../../utils/uuidUtils';
import { ReportsDataError } from './reportsErrorMapper';

const MALFORMED = 'Сервер вернул некорректные данные отчёта. Повторите попытку позже.';
const OVERFLOW = 'Показатель отчёта превышает допустимый предел точных вычислений. Отчёт не отображён.';
const INCONSISTENT = 'Данные отчёта не согласованы. Повторите загрузку.';

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const PAYMENT_ORDER: readonly PaymentMethod[] = ['cash', 'card', 'transfer'];

type JsonRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const readRecord = (value: unknown): JsonRecord => {
  if (!isRecord(value)) throw new ReportsDataError(MALFORMED);
  return value;
};

const readArray = (obj: JsonRecord, key: string): unknown[] => {
  const value = obj[key];
  if (!Array.isArray(value)) throw new ReportsDataError(MALFORMED);
  return value;
};

const readString = (obj: JsonRecord, key: string): string => {
  const value = obj[key];
  if (typeof value !== 'string') throw new ReportsDataError(MALFORMED);
  return value;
};

const readNonEmptyString = (obj: JsonRecord, key: string): string => {
  const value = readString(obj, key);
  if (!value.trim()) throw new ReportsDataError(MALFORMED);
  return value;
};

/** Decimal string → safe integer; malformed → MALFORMED, out of range → OVERFLOW. */
const readUnsigned = (obj: JsonRecord, key: string): number => {
  const raw = obj[key];
  if (typeof raw !== 'string' || !/^(0|[1-9]\d*)$/.test(raw)) throw new ReportsDataError(MALFORMED);
  const value = parseUnsignedDecimal(raw);
  if (value === null) throw new ReportsDataError(OVERFLOW);
  return value;
};

const readSigned = (obj: JsonRecord, key: string): number => {
  const raw = obj[key];
  if (typeof raw !== 'string' || !/^-?(0|[1-9]\d*)$/.test(raw) || raw === '-0') {
    throw new ReportsDataError(MALFORMED);
  }
  const value = parseSignedDecimal(raw);
  if (value === null) throw new ReportsDataError(OVERFLOW);
  return value;
};

const readSmallInt = (obj: JsonRecord, key: string): number => {
  const value = obj[key];
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new ReportsDataError(MALFORMED);
  }
  return value;
};

const readUuid = (obj: JsonRecord, key: string): string => {
  const value = obj[key];
  if (!isValidUuid(value)) throw new ReportsDataError(MALFORMED);
  return value;
};

/** Exact sum of safe integers; throws OVERFLOW instead of losing precision. */
const safeSum = (values: readonly number[]): number => {
  const total = values.reduce((acc, v) => acc + BigInt(v), 0n);
  if (total > MAX_SAFE || total < -MAX_SAFE) throw new ReportsDataError(OVERFLOW);
  return Number(total);
};

const isPaymentMethod = (value: string): value is PaymentMethod => value in PAYMENT_METHODS;

// ---------------------------------------------------------------------------
// Sales report
// ---------------------------------------------------------------------------

/**
 * Parses rpc_get_sales_report into the existing report component models.
 * - `daily` must contain exactly one row per requested interval, in order, with day_start equal to
 *   the requested bound (missing / extra / shifted days are rejected).
 * - Totals must be consistent: Σ daily = summary, Σ payments = summary revenue / receipts.
 */
export const mapSalesReport = (
  data: unknown,
  requestedBounds: readonly string[],
  dayKeys: readonly string[]
): SalesReportData => {
  const root = readRecord(data);
  const summaryRaw = readRecord(root.summary);

  const revenueMinor = readUnsigned(summaryRaw, 'revenue_minor');
  const receiptsCount = readUnsigned(summaryRaw, 'receipts_count');
  const unitsSold = readUnsigned(summaryRaw, 'units_sold');
  const totalDiscountMinor = readUnsigned(summaryRaw, 'total_discount_minor');
  const grossProfitMinor = readSigned(summaryRaw, 'gross_profit_minor');

  const dailyRaw = readArray(root, 'daily');
  if (dailyRaw.length !== requestedBounds.length - 1 || dailyRaw.length !== dayKeys.length) {
    throw new ReportsDataError(INCONSISTENT);
  }

  const daily: DailySalesRevenuePoint[] = dailyRaw.map((value, i) => {
    const row = readRecord(value);
    const dayStart = readString(row, 'day_start');
    if (Number.isNaN(Date.parse(dayStart)) || Date.parse(dayStart) !== Date.parse(requestedBounds[i])) {
      throw new ReportsDataError(INCONSISTENT);
    }
    const dayRevenue = readUnsigned(row, 'revenue_minor');
    const dayReceipts = readUnsigned(row, 'receipts_count');
    const [yyyy, mm, dd] = dayKeys[i].split('-');
    return {
      date: dayKeys[i],
      label: `${dd}.${mm}`,
      fullDate: `${dd}.${mm}.${yyyy}`,
      revenue: minorToAmount(dayRevenue),
      receiptsCount: dayReceipts,
      unitsSold: readUnsigned(row, 'units_sold'),
      averageCheck: minorToAmount(calculateAverageMinor(dayRevenue, dayReceipts)),
      totalDiscount: minorToAmount(readUnsigned(row, 'total_discount_minor')),
      cashAmount: minorToAmount(readUnsigned(row, 'cash_minor')),
      cardAmount: minorToAmount(readUnsigned(row, 'card_minor')),
      transferAmount: minorToAmount(readUnsigned(row, 'transfer_minor')),
    };
  });

  // Consistency: per-day series must add up to the summary (exact integers)
  const dailyRevenueMinor = safeSum(dailyRaw.map((v) => readUnsigned(readRecord(v), 'revenue_minor')));
  const dailyReceipts = safeSum(daily.map((d) => d.receiptsCount));
  const dailyUnits = safeSum(daily.map((d) => d.unitsSold));
  if (dailyRevenueMinor !== revenueMinor || dailyReceipts !== receiptsCount || dailyUnits !== unitsSold) {
    throw new ReportsDataError(INCONSISTENT);
  }

  const paymentsRaw = readArray(root, 'payments');
  if (paymentsRaw.length !== PAYMENT_ORDER.length) throw new ReportsDataError(INCONSISTENT);
  const paymentRows = paymentsRaw.map((value, i) => {
    const row = readRecord(value);
    const method = readString(row, 'method');
    if (!isPaymentMethod(method) || method !== PAYMENT_ORDER[i]) throw new ReportsDataError(INCONSISTENT);
    return { method, amountMinor: readUnsigned(row, 'amount_minor'), receipts: readUnsigned(row, 'receipts_count') };
  });
  if (
    safeSum(paymentRows.map((p) => p.amountMinor)) !== revenueMinor ||
    safeSum(paymentRows.map((p) => p.receipts)) !== receiptsCount
  ) {
    throw new ReportsDataError(INCONSISTENT);
  }
  const payments: PaymentReportItem[] = paymentRows.map((p) => ({
    method: p.method,
    label: PAYMENT_METHODS[p.method],
    amount: minorToAmount(p.amountMinor),
    receiptsCount: p.receipts,
    percentage: calculateShareTenths(p.amountMinor, revenueMinor),
  }));

  const popularProducts: ProductSalesReportItem[] = readArray(root, 'popular_products').map((value, i) => {
    const row = readRecord(value);
    const productRevenueMinor = readUnsigned(row, 'revenue_minor');
    return {
      rank: i + 1,
      productId: readUuid(row, 'product_id'),
      productName: readString(row, 'name'),
      sku: readString(row, 'sku'),
      unitsSold: readUnsigned(row, 'units'),
      revenue: minorToAmount(productRevenueMinor),
      revenueShare: calculateShareTenths(productRevenueMinor, revenueMinor),
    };
  });

  return {
    summary: {
      revenue: minorToAmount(revenueMinor),
      receiptsCount,
      unitsSold,
      averageCheck: minorToAmount(calculateAverageMinor(revenueMinor, receiptsCount)),
      totalDiscount: minorToAmount(totalDiscountMinor),
      // Gross profit is the stored per-receipt snapshot (sales.profit_minor), always available
      grossProfit: minorToAmount(grossProfitMinor),
      isGrossProfitAvailable: true,
    },
    daily,
    payments,
    popularProducts,
  };
};

// ---------------------------------------------------------------------------
// Warehouse report
// ---------------------------------------------------------------------------

interface CategoryAccumulator {
  positions: bigint;
  units: bigint;
  purchase: bigint;
  revenue: bigint;
}

const STATUS_ORDER: readonly StockStatus[] = ['in_stock', 'low_stock', 'out_of_stock'];

const toSafeNumber = (value: bigint): number => {
  if (value > MAX_SAFE || value < -MAX_SAFE) throw new ReportsDataError(OVERFLOW);
  return Number(value);
};

/**
 * Parses rpc_get_warehouse_report:
 * - categories completed to all 17 predefined keys; unknown / legacy keys are merged into 'other'
 *   (each server group is counted exactly once);
 * - Σ statuses and Σ category positions must equal active_positions_count.
 */
export const mapWarehouseReport = (data: unknown): WarehouseReportData => {
  const root = readRecord(data);
  const summaryRaw = readRecord(root.summary);

  const activePositionsCount = readUnsigned(summaryRaw, 'active_positions_count');
  const totalUnits = readUnsigned(summaryRaw, 'total_units');
  const purchaseValueMinor = readUnsigned(summaryRaw, 'purchase_value_minor');
  const potentialRevenueMinor = readUnsigned(summaryRaw, 'potential_revenue_minor');
  const potentialProfitMinor = readSigned(summaryRaw, 'potential_profit_minor');
  const attentionTotal = readUnsigned(summaryRaw, 'attention_count');

  const accumulators = new Map<ProductCategory, CategoryAccumulator>(
    PRODUCT_CATEGORY_KEYS.map((key) => [key, { positions: 0n, units: 0n, purchase: 0n, revenue: 0n }])
  );
  const seenRawKeys = new Set<string>();
  for (const value of readArray(root, 'categories')) {
    const row = readRecord(value);
    const rawKey = readString(row, 'category');
    if (seenRawKeys.has(rawKey)) throw new ReportsDataError(INCONSISTENT);
    seenRawKeys.add(rawKey);
    const acc = accumulators.get(parseProductCategory(rawKey));
    if (!acc) throw new ReportsDataError(INCONSISTENT);
    acc.positions += BigInt(readUnsigned(row, 'positions_count'));
    acc.units += BigInt(readUnsigned(row, 'total_units'));
    acc.purchase += BigInt(readUnsigned(row, 'purchase_value_minor'));
    acc.revenue += BigInt(readUnsigned(row, 'potential_revenue_minor'));
  }

  const categories: CategoryStockReportItem[] = PRODUCT_CATEGORY_KEYS.map((key) => {
    const acc = accumulators.get(key) ?? { positions: 0n, units: 0n, purchase: 0n, revenue: 0n };
    return {
      category: key,
      categoryLabel: getCategoryLabel(key),
      positionsCount: toSafeNumber(acc.positions),
      totalUnits: toSafeNumber(acc.units),
      purchaseValue: minorToAmount(toSafeNumber(acc.purchase)),
      potentialRevenue: minorToAmount(toSafeNumber(acc.revenue)),
    };
  });
  if (safeSum(categories.map((c) => c.positionsCount)) !== activePositionsCount) {
    throw new ReportsDataError(INCONSISTENT);
  }

  const statusesRaw = readRecord(root.statuses);
  const counts = STATUS_ORDER.map((status) => readUnsigned(statusesRaw, status));
  if (safeSum(counts) !== activePositionsCount) throw new ReportsDataError(INCONSISTENT);
  const statuses: StockStatusReportItem[] = STATUS_ORDER.map((status, i) => ({
    status,
    label: getStockStatusLabel(status),
    count: counts[i],
    percentage: calculateShareTenths(counts[i], activePositionsCount),
  }));

  const attention: AttentionProductItem[] = readArray(root, 'attention').map((value) => {
    const row = readRecord(value);
    const status = readString(row, 'status');
    if (status !== 'low_stock' && status !== 'out_of_stock') throw new ReportsDataError(MALFORMED);
    const stock = readSmallInt(row, 'stock');
    return {
      id: readUuid(row, 'id'),
      name: readString(row, 'name'),
      sku: readString(row, 'sku'),
      category: parseProductCategory(readString(row, 'category')),
      categoryLabel: readString(row, 'category_label'),
      stock,
      minStockThreshold: readSmallInt(row, 'min_stock_threshold'),
      unit: 'шт.',
      purchasePrice: minorToAmount(readUnsigned(row, 'purchase_price_minor')),
      stockPurchaseValue: minorToAmount(readUnsigned(row, 'stock_purchase_value_minor')),
      status,
      severity: stock === 0 ? 'critical' : 'warning',
    };
  });
  if (attention.length > attentionTotal) throw new ReportsDataError(INCONSISTENT);

  return {
    summary: {
      activePositionsCount,
      totalUnitsInStock: totalUnits,
      totalPurchaseValue: minorToAmount(purchaseValueMinor),
      totalPotentialRevenue: minorToAmount(potentialRevenueMinor),
      potentialProfit: minorToAmount(potentialProfitMinor),
      attentionItemsCount: attentionTotal,
      isOverflow: false,
    },
    categories,
    statuses,
    attention,
    attentionTotal,
  };
};

// ---------------------------------------------------------------------------
// Warehouse CSV export page
// ---------------------------------------------------------------------------

const isStockStatus = (value: string): value is StockStatus =>
  value === 'in_stock' || value === 'low_stock' || value === 'out_of_stock';

/** Parses one page of rpc_get_warehouse_report_export (rows ordered by id ASC, at most `limit`). */
export const mapWarehouseExportPage = (data: unknown, limit: number): WarehouseExportPage => {
  const root = readRecord(data);
  const snapshotAt = readNonEmptyString(root, 'snapshot_at');
  if (Number.isNaN(Date.parse(snapshotAt))) throw new ReportsDataError(MALFORMED);

  const rowsRaw = readArray(root, 'rows');
  if (rowsRaw.length > limit) throw new ReportsDataError(INCONSISTENT);

  const rows: WarehouseExportRow[] = rowsRaw.map((value) => {
    const row = readRecord(value);
    const status = readString(row, 'status');
    if (!isStockStatus(status)) throw new ReportsDataError(MALFORMED);
    return {
      id: readUuid(row, 'id'),
      sku: readString(row, 'sku'),
      barcode: readString(row, 'barcode'),
      name: readString(row, 'name'),
      categoryLabel: readString(row, 'category_label'),
      purchasePriceMinor: readUnsigned(row, 'purchase_price_minor'),
      sellingPriceMinor: readUnsigned(row, 'selling_price_minor'),
      stock: readSmallInt(row, 'stock'),
      minStockThreshold: readSmallInt(row, 'min_stock_threshold'),
      purchaseValueMinor: readUnsigned(row, 'purchase_value_minor'),
      potentialRevenueMinor: readUnsigned(row, 'potential_revenue_minor'),
      status,
    };
  });

  for (let i = 1; i < rows.length; i++) {
    if (!(rows[i - 1].id < rows[i].id)) throw new ReportsDataError(INCONSISTENT);
  }

  const next = root.next_after_id;
  let nextAfterId: string | null = null;
  if (next !== null) {
    if (!isValidUuid(next)) throw new ReportsDataError(MALFORMED);
    nextAfterId = next;
  }
  if (nextAfterId !== null && (rows.length !== limit || rows[rows.length - 1]?.id !== nextAfterId)) {
    throw new ReportsDataError(INCONSISTENT);
  }

  return { snapshotAt, rows, nextAfterId };
};
