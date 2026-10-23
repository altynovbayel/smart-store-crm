import type { IncomeReceipt, IncomeReceiptItem } from '../../types';
import { minorToSom, MAX_SAFE_PRICE_MINOR } from '../../utils/moneyUtils';
import { isValidUuid } from '../../utils/uuidUtils';
import { toEpochMicros } from '../../utils/outcomePriceHistory';

/** Raised when a rpc_list_income_receipts / rpc_get_income_receipt response is malformed. */
export class IncomeDataError extends Error {
  constructor(message = 'Сервер вернул некорректные данные приходных накладных. Повторите загрузку.') {
    super(message);
    this.name = 'IncomeDataError';
  }
}

type JsonRecord = Record<string, unknown>;

/** Exact field sets (migration 20261021120000_rbac_income_read_rpcs). Any other key rejects the response. */
const RECEIPT_KEYS = [
  'id', 'receipt_number', 'supplier', 'supplier_document_number', 'received_at', 'created_at',
  'created_by_name', 'comment', 'total_minor', 'items',
];
const LINE_KEYS = [
  'id', 'product_id', 'product_name_snapshot', 'sku_snapshot', 'quantity', 'purchase_price_minor',
  'subtotal_minor',
];
const MAX_QUANTITY = 100_000_000;

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const readExact = (value: unknown, keys: readonly string[]): JsonRecord => {
  if (!isRecord(value)) throw new IncomeDataError();
  const own = Object.keys(value);
  if (own.length !== keys.length || !keys.every((k) => Object.prototype.hasOwnProperty.call(value, k))) {
    throw new IncomeDataError();
  }
  return value;
};

const readText = (row: JsonRecord, key: string): string => {
  const value = row[key];
  if (typeof value !== 'string' || value.trim().length === 0) throw new IncomeDataError();
  return value;
};

const readNullableText = (row: JsonRecord, key: string): string | null => {
  const value = row[key];
  if (value === null) return null;
  if (typeof value !== 'string') throw new IncomeDataError();
  return value;
};

const readInt = (row: JsonRecord, key: string, min: number, max: number): number => {
  const value = row[key];
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new IncomeDataError();
  }
  return value;
};

const readUuid = (row: JsonRecord, key: string): string => {
  const value = row[key];
  // PostgreSQL emits canonical lowercase uuids; string order then equals uuid byte order
  if (!isValidUuid(value) || value !== value.toLowerCase()) throw new IncomeDataError();
  return value;
};

/** Timestamp kept as the exact server string; its epoch microseconds are used for order checks. */
const readTimestamp = (row: JsonRecord, key: string): { raw: string; micros: number } => {
  const raw = row[key];
  if (typeof raw !== 'string') throw new IncomeDataError();
  const micros = toEpochMicros(raw);
  if (micros === null) throw new IncomeDataError();
  return { raw, micros };
};

/** Position of a receipt in the server order (received_at DESC, id DESC). */
export interface IncomeReceiptOrderKey {
  receivedMicros: number;
  id: string;
}

/** True when `a` strictly precedes `b` in received_at DESC, id DESC order. */
export const isBeforeInIncomeOrder = (a: IncomeReceiptOrderKey, b: IncomeReceiptOrderKey): boolean =>
  a.receivedMicros !== b.receivedMicros ? a.receivedMicros > b.receivedMicros : a.id > b.id;

const mapLine = (value: unknown, seenProducts: Set<string>): { item: IncomeReceiptItem; subtotalMinor: number } => {
  const row = readExact(value, LINE_KEYS);
  const productId = readUuid(row, 'product_id');
  // One line per product in a receipt (income_items_unique_product_per_receipt)
  if (seenProducts.has(productId)) throw new IncomeDataError();
  seenProducts.add(productId);

  const quantity = readInt(row, 'quantity', 1, MAX_QUANTITY);
  const priceMinor = readInt(row, 'purchase_price_minor', 0, MAX_SAFE_PRICE_MINOR);
  const subtotalMinor = readInt(row, 'subtotal_minor', 0, Number.MAX_SAFE_INTEGER);
  if (subtotalMinor !== quantity * priceMinor) throw new IncomeDataError();

  return {
    item: {
      id: readUuid(row, 'id'),
      productId,
      productName: readText(row, 'product_name_snapshot'),
      sku: readText(row, 'sku_snapshot'),
      quantity,
      purchasePrice: minorToSom(priceMinor),
      totalAmount: minorToSom(subtotalMinor),
    },
    subtotalMinor,
  };
};

/**
 * Parses one receipt. Lines keep the server order (created_at, id ASC — the RPC sends no line
 * created_at), the total must equal the sum of line subtotals, and a receipt has at least one line.
 */
export const mapIncomeReceiptRpc = (
  value: unknown,
  seenLineIds: Set<string>
): { receipt: IncomeReceipt; order: IncomeReceiptOrderKey } => {
  const row = readExact(value, RECEIPT_KEYS);
  const id = readUuid(row, 'id');
  const receivedAt = readTimestamp(row, 'received_at');
  const createdAt = readTimestamp(row, 'created_at');
  const totalMinor = readInt(row, 'total_minor', 0, Number.MAX_SAFE_INTEGER);

  if (!Array.isArray(row.items) || row.items.length === 0) throw new IncomeDataError();
  const seenProducts = new Set<string>();
  let sumMinor = 0;
  const items = row.items.map((line) => {
    const parsed = mapLine(line, seenProducts);
    if (seenLineIds.has(parsed.item.id)) throw new IncomeDataError();
    seenLineIds.add(parsed.item.id);
    sumMinor += parsed.subtotalMinor;
    if (!Number.isSafeInteger(sumMinor)) throw new IncomeDataError();
    return parsed.item;
  });
  if (sumMinor !== totalMinor) throw new IncomeDataError();

  const comment = readNullableText(row, 'comment');
  return {
    receipt: {
      id,
      receiptNumber: readText(row, 'receipt_number'),
      supplier: readText(row, 'supplier'),
      documentNumber: readNullableText(row, 'supplier_document_number') ?? '',
      receivedAt: receivedAt.raw,
      createdAt: createdAt.raw,
      responsiblePerson: readText(row, 'created_by_name'),
      comment: comment ?? undefined,
      items,
      totalQuantity: items.reduce((sum, it) => sum + it.quantity, 0),
      totalAmount: minorToSom(totalMinor),
      status: 'completed',
    },
    order: { receivedMicros: receivedAt.micros, id },
  };
};

/** Keyset cursor exactly as sent by the server; received_at is passed back as the original string. */
export interface IncomeReceiptsCursor {
  receivedAt: string;
  id: string;
  order: IncomeReceiptOrderKey;
}

export interface IncomeReceiptsPage {
  receipts: IncomeReceipt[];
  order: IncomeReceiptOrderKey[];
  nextCursor: IncomeReceiptsCursor | null;
}

/**
 * Parses a rpc_list_income_receipts page:
 * - root is exactly { rows, next_cursor }; at most `limit` receipts (a page may hold fewer
 *   because of the server line budget while next_cursor is still set);
 * - receipts strictly ordered by received_at DESC, id DESC; receipt and line ids are unique
 *   (also across pages through `seenReceiptIds` / `seenLineIds`);
 * - next_cursor is null or exactly { received_at, id } of the last receipt of a non-empty page.
 */
export const mapIncomeReceiptsPage = (
  data: unknown,
  limit: number,
  seenReceiptIds: Set<string>,
  seenLineIds: Set<string>
): IncomeReceiptsPage => {
  const root = readExact(data, ['rows', 'next_cursor']);
  if (!Array.isArray(root.rows) || root.rows.length > limit) throw new IncomeDataError();

  const receipts: IncomeReceipt[] = [];
  const order: IncomeReceiptOrderKey[] = [];
  for (const value of root.rows) {
    const parsed = mapIncomeReceiptRpc(value, seenLineIds);
    if (seenReceiptIds.has(parsed.receipt.id)) throw new IncomeDataError();
    seenReceiptIds.add(parsed.receipt.id);
    const previous = order[order.length - 1];
    if (previous && !isBeforeInIncomeOrder(previous, parsed.order)) throw new IncomeDataError();
    receipts.push(parsed.receipt);
    order.push(parsed.order);
  }

  let nextCursor: IncomeReceiptsCursor | null = null;
  if (root.next_cursor !== null) {
    const cursor = readExact(root.next_cursor, ['received_at', 'id']);
    const receivedAt = readTimestamp(cursor, 'received_at');
    const id = readUuid(cursor, 'id');
    const last = order[order.length - 1];
    if (!last || last.id !== id || last.receivedMicros !== receivedAt.micros) throw new IncomeDataError();
    nextCursor = { receivedAt: receivedAt.raw, id, order: last };
  }

  return { receipts, order, nextCursor };
};

/** Parses rpc_get_income_receipt: { receipt: <receipt> | null }; a returned receipt must be the requested one. */
export const mapGetIncomeReceiptResponse = (data: unknown, receiptId: string): IncomeReceipt | null => {
  const root = readExact(data, ['receipt']);
  if (root.receipt === null) return null;
  const { receipt } = mapIncomeReceiptRpc(root.receipt, new Set<string>());
  if (receipt.id !== receiptId.toLowerCase()) throw new IncomeDataError();
  return receipt;
};
