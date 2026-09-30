import type { InventoryState } from '../context/InventoryContext';
import { initialWarehouseProducts } from './mockProducts';
import { initialIncomeReceipts } from './mockIncome';
import { initialWarehouseMovements } from './mockMovements';

/**
 * Pure function forming the unified, accounting-consistent initial state.
 * Prevents double-accounting or desynchronization across route changes and StrictMode.
 */
export const createInitialInventoryState = (): InventoryState => {
  return {
    products: initialWarehouseProducts,
    movements: initialWarehouseMovements,
    incomeReceipts: initialIncomeReceipts,
  };
};
