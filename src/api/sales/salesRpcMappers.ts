import type { Database } from '../../types/database.types';
import type { Sale, SaleItem, SalesRpcRole } from '../../types';
import { PAYMENT_METHODS } from '../../types';
import { isValidUuid } from '../../utils/uuidUtils';
import { toEpochMicros } from '../../utils/outcomePriceHistory';
import { fromServerDiscount, signedMinorToAmount } from '../../utils/saleMinorCalculations';
import { buildPrimaryProductName, sumSaleItemUnits } from './salesMappers';

/**
 * Strict parsers of the role-aware sales RPCs (migration 20261020100000):
 * rpc_list_sales, rpc_get_sale and rpc_has_any_sales.
 * - The field set of every receipt and line is checked EXACTLY for the role returned by the server:
 *   a cashier payload with profit / cost / purchase-snapshot fields (or any other extra key)
 *   is a load error, never silently stripped; a missing field is an error too.
 * - Cost values exist only in admin payloads; for a cashier they are null in the model (never 0).
 * - Cursor strings are kept exactly as received (no Date round-trip).
 */
export class SalesDataError extends Error {
  constructor(message = 'Сервер вернул некорректные данные чеков. Повторите загрузку.') {
    super(message);
    this.name = 'SalesDataError';
  }
}

type JsonRecord = Record<string, unknown>;
type Enums = Database['public']['Enums'];

const MAX_SAFE_MINOR = Number.MAX_SAFE_INTEGER;
const MAX_QUANTITY = 100_000_000;
const MAX_PERCENT_BPS = 10_000;

const SALE_KEYS_BASE = [
  'id', 'receipt_number', 'sold_at', 'created_at', 'payment_method', 'status',
  'subtotal_minor', 'item_discount_total_minor', 'receipt_discount_type', 'receipt_discount_value',
  'receipt_discount_minor', 'total_discount_minor', 'total_minor', 'received_minor', 'change_minor',
  'comment', 'created_by_name', 'items',
] as const;
const LINE_KEYS_BASE = [
  'id', 'product_id', 'product_name_snapshot', 'sku_snapshot', 'barcode_snapshot', 'quantity',
  'selling_price_snapshot_minor', 'discount_type', 'discount_value', 'gross_minor',
  'item_discount_minor', 'receipt_discount_allocated_minor', 'net_total_minor', 'created_at',
] as const;

/** Exact key sets per role. */
export const SALE_RPC_KEYS: Record<SalesRpcRole, readonly string[]> = {
  admin: [...SALE_KEYS_BASE, 'profit_minor'],
  cashier: SALE_KEYS_BASE,
};
export const SALE_LINE_RPC_KEYS: Record<SalesRpcRole, readonly string[]> = {
  admin: [...LINE_KEYS_BASE, 'purchase_price_snapshot_minor', 'cost_total_minor', 'profit_minor'],
  cashier: LINE_KEYS_BASE,
};

const isPaymentMethod = (value: unknown): value is Enums['payment_method'] =>
  value === 'cash' || value === 'card' || value === 'transfer';
const isDiscountType = (value: unknown): value is Enums['discount_type'] =>
  value === 'none' || value === 'fixed' || value === 'percent';

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const readRecord = (value: unknown): JsonRecord => {
  if (!isRecord(value)) throw new SalesDataError();
  return value;
};

const assertExactKeys = (row: JsonRecord, expected: readonly string[]): void => {
  const keys = Object.keys(row);
  if (keys.length !== expected.length || !expected.every((k) => Object.prototype.hasOwnProperty.call(row, k))) {
    throw new SalesDataError();
  }
};

const readString = (row: JsonRecord, key: string): string => {
  const value = row[key];
  if (typeof value !== 'string') throw new SalesDataError();
  return value;
};

const readNonEmptyString = (row: JsonRecord, key: string): string => {
  const value = readString(row, key);
  if (value.trim().length === 0) throw new SalesDataError();
  return value;
};

const readNullableString = (row: JsonRecord, key: string): string | null => {
  const value = row[key];
  if (value === null) return null;
  if (typeof value !== 'string') throw new SalesDataError();
  return value;
};

const readInt = (row: JsonRecord, key: string, min: number, max: number): number => {
  const value = row[key];
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new SalesDataError();
  }
  return value;
};

const readNullableInt = (row: JsonRecord, key: string, min: number, max: number): number | null =>
  row[key] === null ? null : readInt(row, key, min, max);

/** Canonical lowercase uuid (PostgreSQL output): string order then equals uuid byte order. */
const readUuid = (row: JsonRecord, key: string): string => {
  const value = row[key];
  if (!isValidUuid(value) || value !== value.toLowerCase()) throw new SalesDataError();
  return value;
};

const readTimestamp = (row: JsonRecord, key: string): { raw: string; micros: number } => {
  const raw = readString(row, key);
  const micros = toEpochMicros(raw);
  if (micros === null) throw new SalesDataError();
  return { raw, micros };
};

const readPaymentMethod = (row: JsonRecord, key: string): Enums['payment_method'] => {
  const value = row[key];
  if (!isPaymentMethod(value)) throw new SalesDataError();
  return value;
};

const readDiscountType = (row: JsonRecord, key: string): Enums['discount_type'] => {
  const value = row[key];
  if (!isDiscountType(value)) throw new SalesDataError();
  return value;
};

export const readSalesRole = (root: JsonRecord): SalesRpcRole => {
  if (root.role !== 'admin' && root.role !== 'cashier') throw new SalesDataError();
  return root.role;
};

const toAmount = (minor: number): number => signedMinorToAmount(minor);

/** Server line order: created_at ASC, id ASC. */
interface ParsedLine {
  item: SaleItem;
  quantity: number;
  createdMicros: number;
}

const mapLine = (value: unknown, role: SalesRpcRole): ParsedLine => {
  const row = readRecord(value);
  assertExactKeys(row, SALE_LINE_RPC_KEYS[role]);

  const quantity = readInt(row, 'quantity', 1, MAX_QUANTITY);
  const unitPriceMinor = readInt(row, 'selling_price_snapshot_minor', 0, MAX_SAFE_MINOR);
  const discountType = readDiscountType(row, 'discount_type');
  const discountValue = readInt(
    row, 'discount_value', 0, discountType === 'percent' ? MAX_PERCENT_BPS : MAX_SAFE_MINOR
  );
  const grossMinor = readInt(row, 'gross_minor', 0, MAX_SAFE_MINOR);
  const itemDiscountMinor = readInt(row, 'item_discount_minor', 0, grossMinor);
  const allocatedMinor = readInt(row, 'receipt_discount_allocated_minor', 0, grossMinor - itemDiscountMinor);
  const netMinor = readInt(row, 'net_total_minor', 0, MAX_SAFE_MINOR);
  if (grossMinor !== quantity * unitPriceMinor || netMinor !== grossMinor - itemDiscountMinor - allocatedMinor) {
    throw new SalesDataError();
  }
  const discount = fromServerDiscount(discountType, discountValue);

  let purchasePriceSnapshot: number | null = null;
  let costAmount: number | null = null;
  let profitAmount: number | null = null;
  if (role === 'admin') {
    const purchaseMinor = readInt(row, 'purchase_price_snapshot_minor', 0, MAX_SAFE_MINOR);
    const costMinor = readInt(row, 'cost_total_minor', 0, MAX_SAFE_MINOR);
    const profitMinor = readInt(row, 'profit_minor', -MAX_SAFE_MINOR, MAX_SAFE_MINOR);
    if (costMinor !== quantity * purchaseMinor || profitMinor !== netMinor - costMinor) {
      throw new SalesDataError();
    }
    purchasePriceSnapshot = toAmount(purchaseMinor);
    costAmount = toAmount(costMinor);
    profitAmount = toAmount(profitMinor);
  }

  const barcode = readNullableString(row, 'barcode_snapshot');
  return {
    quantity,
    createdMicros: readTimestamp(row, 'created_at').micros,
    item: {
      id: readUuid(row, 'id'),
      productId: readUuid(row, 'product_id'),
      productName: readNonEmptyString(row, 'product_name_snapshot'),
      sku: readNonEmptyString(row, 'sku_snapshot'),
      barcode: barcode ?? undefined,
      quantity,
      unitPrice: toAmount(unitPriceMinor),
      purchasePriceSnapshot,
      grossAmount: toAmount(grossMinor),
      discountType: discount.discountType,
      discountValue: discount.discountValue,
      discountAmount: toAmount(itemDiscountMinor),
      // Legacy meaning: gross − item discount, BEFORE the receipt discount allocation
      finalAmount: toAmount(grossMinor - itemDiscountMinor),
      costAmount,
      profitAmount,
      receiptDiscountAllocated: toAmount(allocatedMinor),
      netAmount: toAmount(netMinor),
    },
  };
};

export interface ParsedSale {
  sale: Sale;
  soldMicros: number;
  createdMicros: number;
}

/** Parses one receipt for the role returned by the server. */
export const mapSaleRpc = (value: unknown, role: SalesRpcRole): ParsedSale => {
  const row = readRecord(value);
  assertExactKeys(row, SALE_RPC_KEYS[role]);

  if (readString(row, 'status') !== 'completed') throw new SalesDataError();
  const paymentMethod = readPaymentMethod(row, 'payment_method');
  const soldAt = readTimestamp(row, 'sold_at');
  const createdAt = readTimestamp(row, 'created_at');

  const subtotalMinor = readInt(row, 'subtotal_minor', 0, MAX_SAFE_MINOR);
  const itemDiscountTotalMinor = readInt(row, 'item_discount_total_minor', 0, subtotalMinor);
  const receiptDiscountType = readDiscountType(row, 'receipt_discount_type');
  const receiptDiscountValue = readInt(
    row, 'receipt_discount_value', 0, receiptDiscountType === 'percent' ? MAX_PERCENT_BPS : MAX_SAFE_MINOR
  );
  const receiptDiscountMinor = readInt(row, 'receipt_discount_minor', 0, subtotalMinor - itemDiscountTotalMinor);
  const totalDiscountMinor = readInt(row, 'total_discount_minor', 0, subtotalMinor);
  const totalMinor = readInt(row, 'total_minor', 0, MAX_SAFE_MINOR);
  if (
    totalDiscountMinor !== itemDiscountTotalMinor + receiptDiscountMinor ||
    totalMinor !== subtotalMinor - totalDiscountMinor
  ) {
    throw new SalesDataError();
  }
  const receivedMinor = readNullableInt(row, 'received_minor', 0, MAX_SAFE_MINOR);
  const changeMinor = readNullableInt(row, 'change_minor', 0, MAX_SAFE_MINOR);
  if ((paymentMethod === 'cash') !== (receivedMinor !== null && changeMinor !== null) ||
      (receivedMinor === null) !== (changeMinor === null)) {
    throw new SalesDataError();
  }

  let profitAmount: number | null = null;
  let costAmount: number | null = null;
  if (role === 'admin') {
    const profitMinor = readInt(row, 'profit_minor', -MAX_SAFE_MINOR, MAX_SAFE_MINOR);
    profitAmount = toAmount(profitMinor);
    // sales has no cost column: cost = total − profit (equals Σ line cost)
    costAmount = toAmount(totalMinor - profitMinor);
  }

  if (!Array.isArray(row.items) || row.items.length === 0) throw new SalesDataError();
  const lines = row.items.map((line) => mapLine(line, role));
  const lineIds = new Set<string>();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (lineIds.has(line.item.id)) throw new SalesDataError();
    lineIds.add(line.item.id);
    const prev = lines[i - 1];
    if (prev && (prev.createdMicros > line.createdMicros ||
        (prev.createdMicros === line.createdMicros && !(prev.item.id < line.item.id)))) {
      throw new SalesDataError();
    }
  }
  const items = lines.map((l) => l.item);
  const receiptDiscount = fromServerDiscount(receiptDiscountType, receiptDiscountValue);
  const comment = readNullableString(row, 'comment');

  return {
    soldMicros: soldAt.micros,
    createdMicros: createdAt.micros,
    sale: {
      id: readUuid(row, 'id'),
      receiptNumber: readNonEmptyString(row, 'receipt_number'),
      soldAt: soldAt.raw,
      createdAt: createdAt.raw,
      paymentMethod,
      paymentMethodLabel: PAYMENT_METHODS[paymentMethod],
      items,
      subtotal: toAmount(subtotalMinor),
      itemDiscountTotal: toAmount(itemDiscountTotalMinor),
      receiptDiscountType: receiptDiscount.discountType,
      receiptDiscountValue: receiptDiscount.discountValue,
      receiptDiscountAmount: toAmount(receiptDiscountMinor),
      totalAmount: toAmount(totalMinor),
      costAmount,
      profitAmount,
      receivedAmount: receivedMinor === null ? undefined : toAmount(receivedMinor),
      changeAmount: changeMinor === null ? undefined : toAmount(changeMinor),
      responsiblePerson: readNonEmptyString(row, 'created_by_name'),
      comment: comment ?? undefined,
      status: 'completed',
      statusLabel: 'Завершено',
      primaryProductName: buildPrimaryProductName(items),
      itemsCount: sumSaleItemUnits(lines),
    },
  };
};

/** Keyset cursor exactly as returned by the server (strings are passed back unchanged). */
export interface SalesCursor {
  soldAt: string;
  createdAt: string;
  id: string;
}

interface CursorKey {
  soldMicros: number;
  createdMicros: number;
  id: string;
}

/** Strict DESC tuple order: a comes AFTER b in (sold_at, created_at, id) DESC order. */
export const isAfterInDescOrder = (a: CursorKey, b: CursorKey): boolean => {
  if (a.soldMicros !== b.soldMicros) return a.soldMicros < b.soldMicros;
  if (a.createdMicros !== b.createdMicros) return a.createdMicros < b.createdMicros;
  return a.id < b.id;
};

export interface SalesPage {
  role: SalesRpcRole;
  sales: Sale[];
  /** Order keys of the rows (same order as `sales`). */
  keys: CursorKey[];
  nextCursor: SalesCursor | null;
  nextCursorKey: CursorKey | null;
}

/**
 * Parses a rpc_list_sales page: rows strictly in (sold_at, created_at, id) DESC order, unique ids;
 * next_cursor only for a FULL page and equal to its last row.
 */
export const mapSalesPage = (data: unknown, limit: number): SalesPage => {
  const root = readRecord(data);
  assertExactKeys(root, ['role', 'rows', 'next_cursor']);
  const role = readSalesRole(root);
  if (!Array.isArray(root.rows) || root.rows.length > limit) throw new SalesDataError();

  const parsed = root.rows.map((row) => mapSaleRpc(row, role));
  const keys: CursorKey[] = parsed.map((p) => ({
    soldMicros: p.soldMicros,
    createdMicros: p.createdMicros,
    id: p.sale.id,
  }));
  for (let i = 1; i < keys.length; i++) {
    if (!isAfterInDescOrder(keys[i], keys[i - 1])) throw new SalesDataError();
  }

  let nextCursor: SalesCursor | null = null;
  let nextCursorKey: CursorKey | null = null;
  if (root.next_cursor !== null) {
    const cursor = readRecord(root.next_cursor);
    assertExactKeys(cursor, ['sold_at', 'created_at', 'id']);
    const soldAt = readTimestamp(cursor, 'sold_at');
    const createdAt = readTimestamp(cursor, 'created_at');
    const id = readUuid(cursor, 'id');
    const last = keys[keys.length - 1];
    if (
      keys.length !== limit ||
      !last ||
      last.id !== id ||
      last.soldMicros !== soldAt.micros ||
      last.createdMicros !== createdAt.micros
    ) {
      throw new SalesDataError();
    }
    nextCursor = { soldAt: soldAt.raw, createdAt: createdAt.raw, id };
    nextCursorKey = { soldMicros: soldAt.micros, createdMicros: createdAt.micros, id };
  }

  return { role, sales: parsed.map((p) => p.sale), keys, nextCursor, nextCursorKey };
};

/** Parses a rpc_get_sale response; the receipt (if any) must be the requested one. */
export const mapGetSaleResponse = (data: unknown, saleId: string): { role: SalesRpcRole; sale: Sale | null } => {
  const root = readRecord(data);
  assertExactKeys(root, ['role', 'sale']);
  const role = readSalesRole(root);
  if (root.sale === null) return { role, sale: null };
  const { sale } = mapSaleRpc(root.sale, role);
  if (sale.id !== saleId.toLowerCase()) throw new SalesDataError();
  return { role, sale };
};
