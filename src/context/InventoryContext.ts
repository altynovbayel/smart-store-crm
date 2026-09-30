import { createContext } from 'react';
import type {
  Product,
  ProductFormData,
  WarehouseMovement,
  IncomeReceipt,
  IncomeReceiptFormData,
} from '../types';

export interface InventoryState {
  products: Product[];
  movements: WarehouseMovement[];
  incomeReceipts: IncomeReceipt[];
}

export type InventoryAction =
  | { type: 'ADD_PRODUCT'; payload: ProductFormData }
  | { type: 'UPDATE_PRODUCT'; payload: { id: string; data: ProductFormData } }
  | { type: 'ARCHIVE_PRODUCT'; payload: { id: string } }
  | { type: 'ADD_INCOME_RECEIPT'; payload: IncomeReceiptFormData };

export interface InventoryContextValue {
  products: Product[];
  activeProducts: Product[];
  movements: WarehouseMovement[];
  incomeReceipts: IncomeReceipt[];
  getProductMovements: (productId: string) => WarehouseMovement[];
  getIncomeReceiptById: (id: string) => IncomeReceipt | undefined;
  addProduct: (data: ProductFormData) => void;
  updateProduct: (id: string, data: ProductFormData) => void;
  archiveProduct: (id: string) => { success: boolean; error?: string };
  addIncomeReceipt: (
    data: IncomeReceiptFormData
  ) => { success: boolean; error?: string };
}

export const InventoryContext = createContext<InventoryContextValue | null>(null);
