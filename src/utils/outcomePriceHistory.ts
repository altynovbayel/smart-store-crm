import type { HistoricalPriceResult, Product } from '../types';
import { minorToSom, somToMinor } from './moneyUtils';

/**
 * Minimal price history row shape required for resolution (subset of product_price_history).
 */
export interface PriceHistoryPoint {
  id: string;
  product_id: string;
  purchase_price_minor: number;
  effective_from: string;
  created_at: string;
}

const TIMESTAMP_PATTERN =
  /^(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}(?::?\d{2})?)?$/;

/**
 * Converts a timestamptz string to epoch microseconds, preserving PostgreSQL precision
 * (JS Date truncates to milliseconds, which could reorder points within the same millisecond).
 * Returns null for unparseable input.
 */
export const toEpochMicros = (value: string): number | null => {
  const match = TIMESTAMP_PATTERN.exec(value.trim());
  if (!match) {
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? null : ms * 1000;
  }

  const [, base, fraction = '', rawOffset = 'Z'] = match;
  let offset = rawOffset;
  if (offset !== 'Z') {
    const sign = offset[0];
    const digits = offset.slice(1).replace(':', '');
    offset = `${sign}${digits.slice(0, 2)}:${digits.slice(2, 4).padEnd(2, '0')}`;
  }

  const wholeSecondsMs = Date.parse(`${base.replace(' ', 'T')}${offset}`);
  if (Number.isNaN(wholeSecondsMs)) return null;

  const micros = Number(fraction.padEnd(6, '0').slice(0, 6));
  return wholeSecondsMs * 1000 + micros;
};

/** Byte-order comparison matching PostgreSQL uuid ordering for lowercase canonical UUIDs. */
const compareText = (a: string, b: string): number => {
  const left = a.toLowerCase();
  const right = b.toLowerCase();
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
};

const compareMicros = (a: number | null, b: number | null): number =>
  (a ?? Number.NEGATIVE_INFINITY) - (b ?? Number.NEGATIVE_INFINITY);

/** ORDER BY effective_from ASC, created_at ASC, id ASC */
const comparePointsAsc = (a: PriceHistoryPoint, b: PriceHistoryPoint): number =>
  compareMicros(toEpochMicros(a.effective_from), toEpochMicros(b.effective_from)) ||
  compareMicros(toEpochMicros(a.created_at), toEpochMicros(b.created_at)) ||
  compareText(a.id, b.id);

/**
 * Resolves effective purchase prices exactly like `rpc_create_outcome_document`:
 * 1. Latest point with effective_from <= occurredAt
 *    (ORDER BY effective_from DESC, created_at DESC, id DESC LIMIT 1).
 * 2. Otherwise the earliest known point
 *    (ORDER BY effective_from ASC, created_at ASC, id ASC LIMIT 1).
 * 3. Otherwise the current catalog purchase price.
 */
export const resolveHistoricalPurchasePrices = (
  productIds: string[],
  rows: PriceHistoryPoint[],
  occurredAt: string,
  catalogProducts: Product[]
): Record<string, HistoricalPriceResult> => {
  const targetMicros = toEpochMicros(occurredAt);
  const result: Record<string, HistoricalPriceResult> = {};

  for (const prodId of productIds) {
    const sortedAsc = rows
      .filter((r) => r.product_id === prodId)
      .sort(comparePointsAsc);

    if (sortedAsc.length === 0) {
      const catalogProduct = catalogProducts.find((p) => p.id === prodId);
      const currentPurchasePrice = catalogProduct ? catalogProduct.purchasePrice : 0;
      result[prodId] = {
        productId: prodId,
        purchasePrice: currentPurchasePrice,
        purchasePriceMinor: somToMinor(currentPurchasePrice),
        source: 'catalog_fallback',
        effectiveFrom: null,
      };
      continue;
    }

    let exact: PriceHistoryPoint | undefined;
    if (targetMicros !== null) {
      // Last element of the ascending order among eligible points == first of the DESC order
      for (const point of sortedAsc) {
        const effective = toEpochMicros(point.effective_from);
        if (effective !== null && effective <= targetMicros) {
          exact = point;
        }
      }
    }

    const chosen = exact ?? sortedAsc[0];
    result[prodId] = {
      productId: prodId,
      purchasePrice: minorToSom(chosen.purchase_price_minor),
      purchasePriceMinor: chosen.purchase_price_minor,
      source: exact ? 'exact_history' : 'earliest_history',
      effectiveFrom: chosen.effective_from,
    };
  }

  return result;
};
