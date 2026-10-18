import type { ReportDateRange, ReportPeriod, WarehouseExportRow, CSVCellValue } from '../types';
import { resolveEffectiveReportDateRange, calculateInclusiveCalendarDays } from './reportUtils';
import { localDayStartIso } from './salesHistoryRange';
import { formatCalendarDateKey, parseCustomDate } from './dateUtils';
import { getStockStatusLabel } from './productUtils';
import { buildCSVContent, downloadCSVFile } from './csvUtils';

/** Maximum inclusive length of a report period (bounds = days + 1). */
export const MAX_REPORT_DAYS = 366;

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const UNSIGNED_DECIMAL = /^(0|[1-9]\d*)$/;
const SIGNED_DECIMAL = /^-?(0|[1-9]\d*)$/;

/**
 * Strict non-negative decimal string → safe integer. Rejects fractions, exponent, spaces, "+", "-0",
 * leading zeros and values above Number.MAX_SAFE_INTEGER (returns null, never a lossy number).
 */
export const parseUnsignedDecimal = (value: unknown): number | null => {
  if (typeof value !== 'string' || !UNSIGNED_DECIMAL.test(value)) return null;
  const big = BigInt(value);
  return big <= MAX_SAFE ? Number(big) : null;
};

/** Strict signed decimal string (profit) → safe integer; "-0" and |value| > MAX_SAFE rejected. */
export const parseSignedDecimal = (value: unknown): number | null => {
  if (typeof value !== 'string' || !SIGNED_DECIMAL.test(value) || value === '-0') return null;
  const big = BigInt(value);
  return big <= MAX_SAFE && big >= -MAX_SAFE ? Number(big) : null;
};

/** round(numerator / denominator) half up, for numerator >= 0 and denominator > 0 (BigInt, exact). */
const roundHalfUp = (numerator: bigint, denominator: bigint): bigint =>
  (numerator * 2n + denominator) / (denominator * 2n);

/** Average in integer tyiyns, rounded half up (0 when count is 0). */
export const calculateAverageMinor = (totalMinor: number, count: number): number =>
  count > 0 ? Number(roundHalfUp(BigInt(totalMinor), BigInt(count))) : 0;

/** Percentage share with one decimal (e.g. 33.3), rounded half up; 0 when total is 0. */
export const calculateShareTenths = (part: number, total: number): number =>
  total > 0 ? Number(roundHalfUp(BigInt(part) * 1000n, BigInt(total))) / 10 : 0;

/** Tyiyns → som for DISPLAY / CSV only (all sums are integer tyiyns). */
export const minorToAmount = (minor: number): number => minor / 100;

export interface ReportPeriodBounds {
  /** N + 1 strictly increasing local midnights: [from, before). */
  bounds: string[];
  /** N local calendar day keys (YYYY-MM-DD), one per interval. */
  dayKeys: string[];
  /** Stable primitive identifying the server request. */
  key: string;
}

/**
 * Local calendar bounds of a report period: today → 1 day, week → 7, month → 30,
 * custom → 1..366 inclusive days (both dates required, no future, from <= to).
 * Built from calendar components (new Date(y, m, d + i)) — never by adding 24 h — so DST days keep
 * exact midnights. Returns null for an invalid or incomplete period (no RPC must be made).
 */
export const buildReportPeriodBounds = (
  period: ReportPeriod,
  dateRange: ReportDateRange,
  currentDateKey: string
): ReportPeriodBounds | null => {
  const range = resolveEffectiveReportDateRange(period, dateRange, currentDateKey);
  if (!range) return null;

  const days = calculateInclusiveCalendarDays(range.fromKey, range.toKey);
  if (days === null || days < 1 || days > MAX_REPORT_DAYS) return null;

  const start = parseCustomDate(range.fromKey);
  if (!start) return null;

  const bounds: string[] = [];
  for (let i = 0; i <= days; i++) {
    const bound = localDayStartIso(range.fromKey, i);
    if (!bound) return null;
    bounds.push(bound);
  }

  const dayKeys = Array.from({ length: days }, (_, i) =>
    formatCalendarDateKey(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i))
  );

  return { bounds, dayKeys, key: `${range.fromKey}..${range.toKey}` };
};

const WAREHOUSE_CSV_HEADERS = [
  'Артикул',
  'Штрихкод',
  'Наименование товара',
  'Категория',
  'Цена закупки (сом)',
  'Цена продажи (сом)',
  'Остаток (шт.)',
  'Мин. остаток (шт.)',
  'Закупочная стоимость остатка (сом)',
  'Потенциальная выручка (сом)',
  'Статус',
] as const;

/** Rows sorted by name, then id (pages arrive ordered by id). */
export const sortWarehouseExportRows = (rows: readonly WarehouseExportRow[]): WarehouseExportRow[] =>
  [...rows].sort((a, b) => a.name.localeCompare(b.name, 'ru') || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

/**
 * Builds the warehouse CSV content (same columns as before) from the complete set of export rows.
 * Text cells are protected against formula injection by buildCSVContent.
 */
export const buildWarehouseExportCSV = (rows: readonly WarehouseExportRow[]): string => {
  const csvRows: CSVCellValue[][] = sortWarehouseExportRows(rows).map((r) => [
    r.sku,
    r.barcode,
    r.name,
    r.categoryLabel,
    minorToAmount(r.purchasePriceMinor),
    minorToAmount(r.sellingPriceMinor),
    r.stock,
    r.minStockThreshold,
    minorToAmount(r.purchaseValueMinor),
    minorToAmount(r.potentialRevenueMinor),
    getStockStatusLabel(r.status),
  ]);
  return buildCSVContent(WAREHOUSE_CSV_HEADERS, csvRows);
};

/** Downloads the complete warehouse CSV (object URL is revoked by downloadCSVFile). */
export const downloadWarehouseExportCSV = (rows: readonly WarehouseExportRow[], currentDateKey: string): void => {
  downloadCSVFile(buildWarehouseExportCSV(rows), `smart-store-warehouse-report-${currentDateKey}.csv`);
};
