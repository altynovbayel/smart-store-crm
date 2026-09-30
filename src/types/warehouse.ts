export type WarehouseMovementType =
  | 'income'
  | 'outcome'
  | 'adjustment'
  | 'write_off'
  | 'opening_balance'
  | 'inventory_adjustment';

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
