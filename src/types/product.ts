export type ProductCategory =
  | 'cases'
  | 'cables'
  | 'glass'
  | 'powerbanks'
  | 'headphones'
  | 'adapters'
  | 'memory'
  | 'holders';

export type ProductIconType =
  | 'phone'
  | 'cable'
  | 'glass'
  | 'powerbank'
  | 'earphones'
  | 'adapter'
  | 'sdcard'
  | 'holder';

export type StockStatus = 'in_stock' | 'low_stock' | 'out_of_stock';

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
