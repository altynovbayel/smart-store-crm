import type { ProductCategory, ProductIconType, StockStatus } from '../types';
import { PRODUCT_CATEGORIES, FALLBACK_PRODUCT_CATEGORY } from '../types';

/**
 * Calculates stock status based on current stock and threshold
 * stockQuantity === 0 -> 'out_of_stock'
 * stockQuantity <= minStock -> 'low_stock'
 * otherwise -> 'in_stock'
 */
export const calculateStockStatus = (
  stock: number,
  minStock: number
): StockStatus => {
  if (stock <= 0) {
    return 'out_of_stock';
  }
  if (stock <= minStock) {
    return 'low_stock';
  }
  return 'in_stock';
};

export const getStockStatusLabel = (status: StockStatus): string => {
  switch (status) {
    case 'in_stock':
      return 'В наличии';
    case 'low_stock':
      return 'Мало';
    case 'out_of_stock':
      return 'Нет в наличии';
  }
};

/** All category keys in display order, derived from PRODUCT_CATEGORIES. */
export const PRODUCT_CATEGORY_KEYS: readonly ProductCategory[] = PRODUCT_CATEGORIES.map(
  (c) => c.key
);

const CATEGORY_LABEL_BY_KEY: ReadonlyMap<string, string> = new Map(
  PRODUCT_CATEGORIES.map((c) => [c.key, c.label])
);

/** Runtime type guard for values coming from the database or form controls. */
export const isProductCategory = (value: string): value is ProductCategory =>
  CATEGORY_LABEL_BY_KEY.has(value);

/**
 * Converts a raw stored category key into a known ProductCategory.
 * Unknown or legacy keys are displayed as `other` (never silently as `cases`).
 */
export const parseProductCategory = (value: string): ProductCategory =>
  isProductCategory(value) ? value : FALLBACK_PRODUCT_CATEGORY;

export const getCategoryLabel = (category: ProductCategory): string =>
  CATEGORY_LABEL_BY_KEY.get(category) ??
  CATEGORY_LABEL_BY_KEY.get(FALLBACK_PRODUCT_CATEGORY) ??
  'Другое';

export const getIconTypeByCategory = (category: ProductCategory): ProductIconType => {
  switch (category) {
    case 'cases':
      return 'phone';
    case 'cables':
      return 'cable';
    case 'glass':
      return 'glass';
    case 'powerbanks':
      return 'powerbank';
    case 'headphones':
      return 'earphones';
    case 'adapters':
      return 'adapter';
    case 'memory':
      return 'sdcard';
    case 'holders':
      return 'holder';
    case 'keyboards':
      return 'keyboard';
    case 'speakers':
      return 'speaker';
    case 'grooming':
      return 'grooming';
    case 'tripods':
      return 'tripod';
    case 'cameras':
      return 'camera';
    case 'fmtransmitters':
      return 'fmtransmitter';
    case 'converters':
      return 'converter';
    case 'other':
      return 'package';
    default: {
      // Compile-time exhaustiveness: adding a category without an icon fails the build
      const unhandled: never = category;
      void unhandled;
      return 'package';
    }
  }
};

/**
 * Resolves the effective purchase price of a product at a specific historical timestamp.
 */
export const getHistoricalPurchasePrice = (
  product: { purchasePrice: number; priceHistory?: Array<{ id?: number; purchasePrice: number; effectiveFrom: number; createdAt: number }> },
  documentTimestampMs: number
): number => {
  const history = product.priceHistory;
  if (!history || history.length === 0) {
    return product.purchasePrice;
  }
  const eligible = history.filter((entry) => entry.effectiveFrom <= documentTimestampMs);
  if (eligible.length === 0) {
    const earliest = [...history].sort(
      (a, b) => a.effectiveFrom - b.effectiveFrom || a.createdAt - b.createdAt || (a.id ?? 0) - (b.id ?? 0)
    );
    return earliest[0].purchasePrice;
  }
  const sorted = [...eligible].sort(
    (a, b) => b.effectiveFrom - a.effectiveFrom || b.createdAt - a.createdAt || (b.id ?? 0) - (a.id ?? 0)
  );
  return sorted[0].purchasePrice;
};
