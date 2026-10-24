import type { HistoricalPriceResult, PurchasePriceRpcSource } from '../../types';
import { minorToSom, MAX_SAFE_PRICE_MINOR } from '../../utils/moneyUtils';
import { isValidUuid } from '../../utils/uuidUtils';
import { toEpochMicros } from '../../utils/outcomePriceHistory';

/** Raised when a rpc_get_purchase_prices_at response is malformed or does not match the request. */
export class PurchasePricesDataError extends Error {
  constructor(message = 'Сервер вернул некорректные данные закупочных цен. Повторите загрузку.') {
    super(message);
    this.name = 'PurchasePricesDataError';
  }
}

type JsonRecord = Record<string, unknown>;

const ROOT_KEYS = ['occurred_at', 'items'];
const ITEM_KEYS = ['product_id', 'purchase_price_minor', 'source', 'effective_from'];
const HISTORY_SOURCES: ReadonlySet<string> = new Set<PurchasePriceRpcSource>(['exact_history', 'earliest_history']);

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const assertExactKeys = (value: unknown, expected: readonly string[]): JsonRecord => {
  if (!isRecord(value)) throw new PurchasePricesDataError();
  const keys = Object.keys(value);
  if (keys.length !== expected.length || !expected.every((k) => Object.prototype.hasOwnProperty.call(value, k))) {
    throw new PurchasePricesDataError();
  }
  return value;
};

const readSource = (value: unknown): PurchasePriceRpcSource => {
  if (value === 'exact_history' || value === 'earliest_history' || value === 'catalog_fallback') return value;
  throw new PurchasePricesDataError();
};

/**
 * Parses one rpc_get_purchase_prices_at response for exactly the requested products:
 * - root and item field sets are exact (any other key rejects the response);
 * - occurred_at must be the requested instant (microsecond comparison, any time zone);
 * - one item per requested id (lowercase canonical uuids), ordered by product_id, no extra ids;
 * - the price is a safe integer in range; a history source carries its effective_from,
 *   catalog_fallback carries null. A missing price is an error, never 0.
 */
export const mapPurchasePricesResponse = (
  data: unknown,
  requestedIds: readonly string[],
  occurredAt: string
): Record<string, HistoricalPriceResult> => {
  const root = assertExactKeys(data, ROOT_KEYS);
  const echoed = root.occurred_at;
  const requestedMicros = toEpochMicros(occurredAt);
  if (typeof echoed !== 'string' || requestedMicros === null || toEpochMicros(echoed) !== requestedMicros) {
    throw new PurchasePricesDataError();
  }

  const expected = Array.from(new Set(requestedIds)).sort();
  if (!Array.isArray(root.items) || root.items.length !== expected.length) {
    throw new PurchasePricesDataError();
  }

  const result: Record<string, HistoricalPriceResult> = {};
  root.items.forEach((value, index) => {
    const item = assertExactKeys(value, ITEM_KEYS);
    const productId = item.product_id;
    // Server order is product_id ASC == sorted lowercase uuid strings
    if (!isValidUuid(productId) || productId !== expected[index]) throw new PurchasePricesDataError();

    const minor = item.purchase_price_minor;
    if (typeof minor !== 'number' || !Number.isSafeInteger(minor) || minor < 0 || minor > MAX_SAFE_PRICE_MINOR) {
      throw new PurchasePricesDataError();
    }

    const source = readSource(item.source);
    const effectiveFrom = item.effective_from;
    if (HISTORY_SOURCES.has(source)) {
      if (typeof effectiveFrom !== 'string' || toEpochMicros(effectiveFrom) === null) {
        throw new PurchasePricesDataError();
      }
    } else if (effectiveFrom !== null) {
      throw new PurchasePricesDataError();
    }

    result[productId] = {
      productId,
      purchasePrice: minorToSom(minor),
      purchasePriceMinor: minor,
      source,
      effectiveFrom: typeof effectiveFrom === 'string' ? effectiveFrom : null,
    };
  });

  return result;
};
