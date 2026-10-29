/**
 * Single source of truth for predefined product categories.
 * - `key` is the stable technical identifier stored in `products.category` (never rename).
 * - `label` is the user-facing Russian name stored as the `products.category_label` snapshot.
 * Order: legacy categories first (unchanged), new categories after them, `other` last.
 */
export const PRODUCT_CATEGORIES = [
  { key: 'cases', label: 'Чехлы' },
  { key: 'cables', label: 'Кабели' },
  { key: 'glass', label: 'Защитные стёкла' },
  { key: 'powerbanks', label: 'Power Bank' },
  { key: 'headphones', label: 'Наушники' },
  { key: 'adapters', label: 'Адаптеры' }, // charging blocks and power adapters
  { key: 'memory', label: 'Карты памяти' },
  { key: 'holders', label: 'Автодержатели' },
  { key: 'keyboards', label: 'Клавиатуры' },
  { key: 'speakers', label: 'Колонки' },
  { key: 'grooming', label: 'Шейверы и машинки' },
  { key: 'tripods', label: 'Штативы' },
  { key: 'cameras', label: 'Камеры' },
  { key: 'fmtransmitters', label: 'Автомодуляторы' },
  { key: 'converters', label: 'Переходники' }, // connector / interface converters
  { key: 'chargers', label: 'Зарядные устройства' },
  { key: 'other', label: 'Другое' },
] as const satisfies readonly { key: string; label: string }[];

export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number]['key'];

/** Category preselected in the product creation form. */
export const DEFAULT_PRODUCT_CATEGORY: ProductCategory = 'cases';

/** Category used to display unknown or legacy keys coming from the database. */
export const FALLBACK_PRODUCT_CATEGORY: ProductCategory = 'other';

export type ProductIconType =
  | 'phone'
  | 'cable'
  | 'glass'
  | 'powerbank'
  | 'earphones'
  | 'adapter'
  | 'sdcard'
  | 'holder'
  | 'keyboard'
  | 'speaker'
  | 'grooming'
  | 'tripod'
  | 'camera'
  | 'fmtransmitter'
  | 'converter'
  | 'charger'
  | 'package';

export type StockStatus = 'in_stock' | 'low_stock' | 'out_of_stock';

export interface ProductPriceHistoryEntry {
  id?: number;
  purchasePrice: number;
  effectiveFrom: number;
  createdAt: number;
}

export interface Product {
  id: string;
  sku: string;
  barcode: string;
  name: string;
  category: ProductCategory;
  categoryLabel: string;
  description?: string;
  purchasePrice: number;
  sellingPrice: number;
  stock: number;
  minStockThreshold: number;
  status: StockStatus;
  unit: string;
  iconType: ProductIconType;
  isArchived: boolean;
  priceUpdatedAt?: number;
  priceHistory?: ProductPriceHistoryEntry[];
}

export type ProductSortField = 'name' | 'sellingPrice' | 'purchasePrice' | 'stock';
export type SortDirection = 'asc' | 'desc';

export interface ProductSortConfig {
  field: ProductSortField;
  direction: SortDirection;
}

export interface ProductFilters {
  searchQuery: string;
  category: ProductCategory | 'all';
  status: StockStatus | 'all';
}

export interface ProductFormData {
  name: string;
  sku: string;
  barcode: string;
  category: ProductCategory;
  description: string;
  purchasePrice: number;
  sellingPrice: number;
  minStockThreshold: number;
  stock: number;
}

export interface PopularProductItem {
  id: string;
  rank: number;
  name: string;
  categoryLabel: string;
  salesCount: number;
  totalRevenue: number;
  iconType: ProductIconType;
}

export type LowStockSeverity = 'critical' | 'warning';

export interface LowStockItem {
  id: string;
  name: string;
  stock: number;
  threshold: number;
  severity: LowStockSeverity;
  statusLabel: string;
}
