import type { ProductCategory } from './product';

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
