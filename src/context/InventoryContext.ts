import { createContext } from 'react';
import type { Product, ProductFormData, WarehouseMovement } from '../types';

export interface InventoryState {
  products: Product[];
  movements: WarehouseMovement[];
}

export type InventoryAction =
  | { type: 'ADD_PRODUCT'; payload: ProductFormData }
  | { type: 'UPDATE_PRODUCT'; payload: { id: string; data: ProductFormData } }
  | { type: 'ARCHIVE_PRODUCT'; payload: { id: string } };

export interface InventoryContextValue {
  products: Product[];
  activeProducts: Product[];
  movements: WarehouseMovement[];
  getProductMovements: (productId: string) => WarehouseMovement[];
  addProduct: (data: ProductFormData) => void;
  updateProduct: (id: string, data: ProductFormData) => void;
  archiveProduct: (id: string) => { success: boolean; error?: string };
}

export const InventoryContext = createContext<InventoryContextValue | null>(null);
