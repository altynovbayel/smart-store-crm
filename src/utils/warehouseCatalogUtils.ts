import type {
  Product,
  ProductFilters,
  ProductSortConfig,
  WarehouseCatalogProduct,
} from '../types';

/** Catalog item from a full admin Product (results of the admin mutation RPCs). */
export const catalogItemFromProduct = (product: Product): WarehouseCatalogProduct => ({
  id: product.id,
  sku: product.sku,
  barcode: product.barcode,
  name: product.name,
  category: product.category,
  categoryLabel: product.categoryLabel,
  sellingPrice: product.sellingPrice,
  stock: product.stock,
  minStockThreshold: product.minStockThreshold,
  status: product.status,
  isArchived: product.isArchived,
  unit: product.unit,
  iconType: product.iconType,
  purchasePrice: product.purchasePrice,
  description: product.description ?? '',
  priceUpdatedAt: product.priceUpdatedAt,
});

/**
 * Full Product for the admin modals. Returns null for a row without admin data (cashier catalog):
 * a missing purchase price is never replaced by 0.
 */
export const toAdminProduct = (item: WarehouseCatalogProduct): Product | null => {
  if (item.purchasePrice === null) return null;
  return {
    id: item.id,
    sku: item.sku,
    barcode: item.barcode,
    name: item.name,
    category: item.category,
    categoryLabel: item.categoryLabel,
    description: item.description ?? '',
    purchasePrice: item.purchasePrice,
    sellingPrice: item.sellingPrice,
    stock: item.stock,
    minStockThreshold: item.minStockThreshold,
    status: item.status,
    unit: item.unit,
    iconType: item.iconType,
    isArchived: item.isArchived,
    priceUpdatedAt: item.priceUpdatedAt,
  };
};

export interface WarehouseCatalogStats {
  totalCount: number;
  /** null when purchase prices are not available (cashier) — the card is hidden, never shown as 0. */
  totalCost: number | null;
  lowStockCount: number;
  outOfStockCount: number;
}

export const computeWarehouseStats = (
  products: readonly WarehouseCatalogProduct[],
  showPurchasePrice: boolean
): WarehouseCatalogStats => {
  let totalCost: number | null = showPurchasePrice ? 0 : null;
  let lowStockCount = 0;
  let outOfStockCount = 0;
  for (const p of products) {
    if (p.status === 'low_stock') lowStockCount++;
    if (p.status === 'out_of_stock') outOfStockCount++;
    if (totalCost !== null) {
      totalCost = p.purchasePrice === null ? null : totalCost + p.purchasePrice * p.stock;
    }
  }
  return { totalCount: products.length, totalCost, lowStockCount, outOfStockCount };
};

export const filterCatalogProducts = (
  products: readonly WarehouseCatalogProduct[],
  filters: ProductFilters
): WarehouseCatalogProduct[] => {
  const q = filters.searchQuery.trim().toLowerCase();
  return products.filter((item) => {
    if (
      q &&
      !item.name.toLowerCase().includes(q) &&
      !item.sku.toLowerCase().includes(q) &&
      !item.barcode.toLowerCase().includes(q)
    ) {
      return false;
    }
    if (filters.category !== 'all' && item.category !== filters.category) return false;
    if (filters.status !== 'all' && item.status !== filters.status) return false;
    return true;
  });
};

/** Sort config actually applied: sorting by purchase price is unavailable without the column. */
export const getEffectiveSortConfig = (
  sortConfig: ProductSortConfig,
  showPurchasePrice: boolean
): ProductSortConfig =>
  !showPurchasePrice && sortConfig.field === 'purchasePrice'
    ? { field: 'name', direction: 'asc' }
    : sortConfig;

export const sortCatalogProducts = (
  products: readonly WarehouseCatalogProduct[],
  sortConfig: ProductSortConfig
): WarehouseCatalogProduct[] => {
  const { field, direction } = sortConfig;
  const list = [...products];
  list.sort((a, b) => {
    let comparison: number;
    if (field === 'name') {
      comparison = a.name.localeCompare(b.name, 'ru');
    } else if (field === 'purchasePrice') {
      // Unknown purchase prices always go last, regardless of direction
      if (a.purchasePrice === null || b.purchasePrice === null) {
        return (a.purchasePrice === null ? 1 : 0) - (b.purchasePrice === null ? 1 : 0);
      }
      comparison = a.purchasePrice - b.purchasePrice;
    } else {
      comparison = a[field] - b[field];
    }
    return direction === 'asc' ? comparison : -comparison;
  });
  return list;
};
