import type { OutcomeDocument, OutcomeItem, OutcomeReason } from '../../types';
import { OUTCOME_REASONS } from '../../types';
import { minorToSom, MAX_SAFE_PRICE_MINOR } from '../../utils/moneyUtils';
import { isValidUuid } from '../../utils/uuidUtils';
import { toEpochMicros } from '../../utils/outcomePriceHistory';

/** Raised when a rpc_list_outcome_documents / rpc_get_outcome_document response is malformed. */
export class OutcomeDataError extends Error {
  constructor(message = 'Сервер вернул некорректные данные документов списания. Повторите загрузку.') {
    super(message);
    this.name = 'OutcomeDataError';
  }
}

type JsonRecord = Record<string, unknown>;

/** Exact field sets (migration 20261022100000_rbac_outcome_read_rpcs). Any other key rejects the response. */
const DOCUMENT_KEYS = [
  'id', 'document_number', 'reason', 'reason_comment', 'occurred_at', 'created_at',
  'created_by_name', 'total_cost_minor', 'items',
];
const LINE_KEYS = [
  'id', 'product_id', 'product_name_snapshot', 'sku_snapshot', 'quantity',
  'purchase_price_snapshot_minor', 'subtotal_minor',
];
const MAX_QUANTITY = 100_000_000;

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const readExact = (value: unknown, keys: readonly string[]): JsonRecord => {
  if (!isRecord(value)) throw new OutcomeDataError();
  const own = Object.keys(value);
  if (own.length !== keys.length || !keys.every((k) => Object.prototype.hasOwnProperty.call(value, k))) {
    throw new OutcomeDataError();
  }
  return value;
};

const readText = (row: JsonRecord, key: string): string => {
  const value = row[key];
  if (typeof value !== 'string' || value.trim().length === 0) throw new OutcomeDataError();
  return value;
};

const readNullableText = (row: JsonRecord, key: string): string | null => {
  const value = row[key];
  if (value === null) return null;
  if (typeof value !== 'string') throw new OutcomeDataError();
  return value;
};

const readInt = (row: JsonRecord, key: string, min: number, max: number): number => {
  const value = row[key];
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new OutcomeDataError();
  }
  return value;
};

const readUuid = (row: JsonRecord, key: string): string => {
  const value = row[key];
  // PostgreSQL emits canonical lowercase uuids; string order then equals uuid byte order
  if (!isValidUuid(value) || value !== value.toLowerCase()) throw new OutcomeDataError();
  return value;
};

/** Timestamp kept as the exact server string; its epoch microseconds are used for order checks. */
const readTimestamp = (row: JsonRecord, key: string): { raw: string; micros: number } => {
  const raw = row[key];
  if (typeof raw !== 'string') throw new OutcomeDataError();
  const micros = toEpochMicros(raw);
  if (micros === null) throw new OutcomeDataError();
  return { raw, micros };
};

const isOutcomeReason = (value: unknown): value is OutcomeReason =>
  typeof value === 'string' && Object.prototype.hasOwnProperty.call(OUTCOME_REASONS, value);

/** Position of a document in the server order (occurred_at DESC, id DESC). */
export interface OutcomeDocumentOrderKey {
  occurredMicros: number;
  id: string;
}

/** True when `a` strictly precedes `b` in occurred_at DESC, id DESC order. */
export const isBeforeInOutcomeOrder = (a: OutcomeDocumentOrderKey, b: OutcomeDocumentOrderKey): boolean =>
  a.occurredMicros !== b.occurredMicros ? a.occurredMicros > b.occurredMicros : a.id > b.id;

const mapLine = (value: unknown, seenProducts: Set<string>): { item: OutcomeItem; subtotalMinor: number } => {
  const row = readExact(value, LINE_KEYS);
  const productId = readUuid(row, 'product_id');
  // One line per product in a document (outcome_items_unique_product_per_doc)
  if (seenProducts.has(productId)) throw new OutcomeDataError();
  seenProducts.add(productId);

  const quantity = readInt(row, 'quantity', 1, MAX_QUANTITY);
  const priceMinor = readInt(row, 'purchase_price_snapshot_minor', 0, MAX_SAFE_PRICE_MINOR);
  const subtotalMinor = readInt(row, 'subtotal_minor', 0, Number.MAX_SAFE_INTEGER);
  if (subtotalMinor !== quantity * priceMinor) throw new OutcomeDataError();

  return {
    item: {
      id: readUuid(row, 'id'),
      productId,
      productName: readText(row, 'product_name_snapshot'),
      sku: readText(row, 'sku_snapshot'),
      quantity,
      purchasePrice: minorToSom(priceMinor),
      totalCost: minorToSom(subtotalMinor),
    },
    subtotalMinor,
  };
};

/**
 * Parses one document. Lines keep the server order (id ASC, as the act view shows them) and are
 * not re-sorted; the total must equal the sum of line subtotals; a document has at least one
 * line; reason "other" carries a non-empty comment (outcome_docs_other_reason_comment).
 */
export const mapOutcomeDocumentRpc = (
  value: unknown,
  seenLineIds: Set<string>
): { document: OutcomeDocument; order: OutcomeDocumentOrderKey } => {
  const row = readExact(value, DOCUMENT_KEYS);
  const id = readUuid(row, 'id');
  const occurredAt = readTimestamp(row, 'occurred_at');
  const createdAt = readTimestamp(row, 'created_at');
  const totalMinor = readInt(row, 'total_cost_minor', 0, Number.MAX_SAFE_INTEGER);

  const reason = row.reason;
  if (!isOutcomeReason(reason)) throw new OutcomeDataError();
  const reasonComment = readNullableText(row, 'reason_comment');
  if (reason === 'other' && (reasonComment === null || reasonComment.trim().length === 0)) {
    throw new OutcomeDataError();
  }

  if (!Array.isArray(row.items) || row.items.length === 0) throw new OutcomeDataError();
  const seenProducts = new Set<string>();
  let sumMinor = 0;
  let previousLineId: string | null = null;
  const items = row.items.map((line) => {
    const parsed = mapLine(line, seenProducts);
    if (seenLineIds.has(parsed.item.id)) throw new OutcomeDataError();
    if (previousLineId !== null && !(previousLineId < parsed.item.id)) throw new OutcomeDataError();
    previousLineId = parsed.item.id;
    seenLineIds.add(parsed.item.id);
    sumMinor += parsed.subtotalMinor;
    if (!Number.isSafeInteger(sumMinor)) throw new OutcomeDataError();
    return parsed.item;
  });
  if (sumMinor !== totalMinor) throw new OutcomeDataError();

  return {
    document: {
      id,
      outcomeNumber: readText(row, 'document_number'),
      reason,
      documentDate: occurredAt.raw,
      createdAt: createdAt.raw,
      responsiblePerson: readText(row, 'created_by_name'),
      comment: reasonComment || undefined,
      items,
      totalQuantity: items.reduce((sum, it) => sum + it.quantity, 0),
      totalCost: minorToSom(totalMinor),
      status: 'completed',
    },
    order: { occurredMicros: occurredAt.micros, id },
  };
};

/** Keyset cursor exactly as sent by the server; occurred_at is passed back as the original string. */
export interface OutcomeDocumentsCursor {
  occurredAt: string;
  id: string;
  order: OutcomeDocumentOrderKey;
}

export interface OutcomeDocumentsPage {
  documents: OutcomeDocument[];
  order: OutcomeDocumentOrderKey[];
  nextCursor: OutcomeDocumentsCursor | null;
}

/**
 * Parses a rpc_list_outcome_documents page:
 * - root is exactly { rows, next_cursor }; at most `limit` documents (a page may hold fewer
 *   because of the server line budget while next_cursor is still set);
 * - documents strictly ordered by occurred_at DESC, id DESC; document and line ids are unique
 *   (also across pages through `seenDocumentIds` / `seenLineIds`);
 * - next_cursor is null or exactly { occurred_at, id } of the last document of a non-empty page.
 */
export const mapOutcomeDocumentsPage = (
  data: unknown,
  limit: number,
  seenDocumentIds: Set<string>,
  seenLineIds: Set<string>
): OutcomeDocumentsPage => {
  const root = readExact(data, ['rows', 'next_cursor']);
  if (!Array.isArray(root.rows) || root.rows.length > limit) throw new OutcomeDataError();

  const documents: OutcomeDocument[] = [];
  const order: OutcomeDocumentOrderKey[] = [];
  for (const value of root.rows) {
    const parsed = mapOutcomeDocumentRpc(value, seenLineIds);
    if (seenDocumentIds.has(parsed.document.id)) throw new OutcomeDataError();
    seenDocumentIds.add(parsed.document.id);
    const previous = order[order.length - 1];
    if (previous && !isBeforeInOutcomeOrder(previous, parsed.order)) throw new OutcomeDataError();
    documents.push(parsed.document);
    order.push(parsed.order);
  }

  let nextCursor: OutcomeDocumentsCursor | null = null;
  if (root.next_cursor !== null) {
    const cursor = readExact(root.next_cursor, ['occurred_at', 'id']);
    const occurredAt = readTimestamp(cursor, 'occurred_at');
    const id = readUuid(cursor, 'id');
    const last = order[order.length - 1];
    if (!last || last.id !== id || last.occurredMicros !== occurredAt.micros) throw new OutcomeDataError();
    nextCursor = { occurredAt: occurredAt.raw, id, order: last };
  }

  return { documents, order, nextCursor };
};

/** Parses rpc_get_outcome_document: { document: <document> | null }; a returned document must be the requested one. */
export const mapGetOutcomeDocumentResponse = (data: unknown, documentId: string): OutcomeDocument | null => {
  const root = readExact(data, ['document']);
  if (root.document === null) return null;
  const { document } = mapOutcomeDocumentRpc(root.document, new Set<string>());
  if (document.id !== documentId.toLowerCase()) throw new OutcomeDataError();
  return document;
};
