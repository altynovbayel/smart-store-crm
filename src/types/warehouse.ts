import type { ProductCategory, ProductIconType, StockStatus } from './product';

export type WarehouseMovementType =
  | 'income'
  | 'outcome'
  | 'adjustment'
  | 'write_off'
  | 'opening_balance'
  | 'inventory_adjustment'
  | 'sale';

export interface WarehouseMovement {
  id: string;
  documentNumber: string;
  type: WarehouseMovementType;
  typeLabel: string;
  productId: string;
  productName: string;
  quantity: number; // positive delta for income/opening, +/- delta for adjustment
  unit: string;
  reason?: string;
  createdAt: string;
  author: string;
  receiptId?: string;
  referenceId?: string;
}

export interface WarehouseSummary {
  totalProductsCount: number;
  totalInventoryCost: number;
  lowStockCount: number;
  outOfStockCount: number;
}

export interface CreateProductInput {
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

export interface UpdateProductInput {
  name: string;
  sku: string;
  barcode: string;
  category: ProductCategory;
  description: string;
  purchasePrice: number;
  sellingPrice: number;
  minStockThreshold: number;
}

export interface AdjustStockInput {
  productId: string;
  newStock: number;
  reason: string;
}

export type WarehouseErrorField =
  | 'name'
  | 'sku'
  | 'barcode'
  | 'purchasePrice'
  | 'sellingPrice'
  | 'stock'
  | 'reason';

export interface MappedWarehouseError {
  message: string;
  field?: WarehouseErrorField;
}

export type WarehouseApiResult<T> =
  | { success: true; data: T }
  | { success: false; error: MappedWarehouseError };

export interface ProductFormSubmitResult {
  success: boolean;
  error?: string;
  field?: WarehouseErrorField;
}

// ---------------------------------------------------------------------------
// Role-aware Warehouse catalog (rpc_list_products / rpc_list_product_movements,
// migration 20261019100000). The server decides the field set by the caller's role.
// ---------------------------------------------------------------------------

export type CatalogAccessRole = 'admin' | 'cashier';

/**
 * Warehouse catalog item. Admin-only fields are `null` for a cashier — the server does not send
 * them at all, and the client never substitutes 0 or an empty value for them.
 */
export interface WarehouseCatalogProduct {
  id: string;
  sku: string;
  barcode: string;
  name: string;
  category: ProductCategory;
  categoryLabel: string;
  sellingPrice: number;
  stock: number;
  minStockThreshold: number;
  status: StockStatus;
  isArchived: boolean;
  unit: string;
  iconType: ProductIconType;
  /** Admin only (null for cashier). */
  purchasePrice: number | null;
  /** Admin only (null for cashier). */
  description: string | null;
  /** Admin only. */
  priceUpdatedAt?: number;
}

export interface WarehouseCatalog {
  /** Role resolved by the server for this response. */
  role: CatalogAccessRole;
  products: WarehouseCatalogProduct[];
}

/** Stock movement as displayed on the Warehouse page (cashier: no note / responsible). */
export interface WarehouseMovementView {
  id: string;
  documentNumber: string;
  type: WarehouseMovementType;
  typeLabel: string;
  quantity: number;
  balanceAfter: number;
  unit: string;
  /** occurred_at of the movement (ISO string from the server). */
  createdAt: string;
  /** Admin only: note (supplier, write-off reason, adjustment reason). */
  reason?: string;
  /** Admin only: responsible employee name. */
  author?: string;
}

export interface WarehouseMovementsResult {
  role: CatalogAccessRole;
  movements: WarehouseMovementView[];
}
