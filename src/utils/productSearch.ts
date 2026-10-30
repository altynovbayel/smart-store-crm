import type { SearchableProduct } from '../types';

/**
 * Pure search helpers of the shared "search or scan" field of the document forms.
 * Barcodes and SKUs are compared as strings only (no Number conversion: leading zeros and long
 * codes are preserved). Archived products are never returned.
 */

export const DEFAULT_PRODUCT_SEARCH_LIMIT = 20;

export const normalizeProductQuery = (raw: string): string => raw.trim().toLowerCase();

const isActive = (product: SearchableProduct): boolean => product.isArchived !== true;

/** Active products whose barcode equals the scanned value (trimmed, case-insensitive). */
export const findProductsByExactBarcode = <T extends SearchableProduct>(
  products: readonly T[],
  rawBarcode: string
): T[] => {
  const code = normalizeProductQuery(rawBarcode);
  if (!code) return [];
  return products.filter(
    (p) => isActive(p) && normalizeProductQuery(p.barcode) === code
  );
};

/**
 * Lower rank = better match: exact barcode, exact SKU, name prefix, SKU / barcode prefix,
 * then any substring of name, SKU or barcode. Null = no match.
 */
const rankProduct = (product: SearchableProduct, query: string): number | null => {
  const name = product.name.toLowerCase();
  const sku = normalizeProductQuery(product.sku);
  const barcode = normalizeProductQuery(product.barcode);

  if (barcode && barcode === query) return 0;
  if (sku && sku === query) return 1;
  if (name.startsWith(query)) return 2;
  if (sku.startsWith(query) || (barcode && barcode.startsWith(query))) return 3;
  if (name.includes(query) || sku.includes(query) || barcode.includes(query)) return 4;
  return null;
};

export interface ProductSearchResult<T> {
  results: T[];
  totalMatches: number;
}

/**
 * Case-insensitive search by name, SKU and barcode among active products.
 * Results are ordered by match quality, then by catalog order; at most `limit` are returned.
 */
export const searchProducts = <T extends SearchableProduct>(
  products: readonly T[],
  rawQuery: string,
  limit: number = DEFAULT_PRODUCT_SEARCH_LIMIT
): ProductSearchResult<T> => {
  const query = normalizeProductQuery(rawQuery);
  if (!query) return { results: [], totalMatches: 0 };

  const ranked: { product: T; rank: number; index: number }[] = [];
  products.forEach((product, index) => {
    if (!isActive(product)) return;
    const rank = rankProduct(product, query);
    if (rank !== null) ranked.push({ product, rank, index });
  });

  ranked.sort((a, b) => a.rank - b.rank || a.index - b.index);
  return {
    results: ranked.slice(0, limit).map((r) => r.product),
    totalMatches: ranked.length,
  };
};

let formRowCounter = 0;

/** Unique client-side row id of a document form (distinct even for scans within one millisecond). */
export const createFormRowId = (): string => {
  formRowCounter += 1;
  return `row-${Date.now()}-${formRowCounter}`;
};
