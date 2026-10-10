import { createContext } from 'react';
import type {
  Product,
  ProductFormData,
  WarehouseMovement,
  IncomeReceipt,
  IncomeReceiptFormData,
  OutcomeDocument,
  OutcomeFormData,
  Sale,
  SaleFormData,
} from '../types';

export interface InventoryState {
  products: Product[];
  movements: WarehouseMovement[];
  incomeReceipts: IncomeReceipt[];
  outcomeDocuments: OutcomeDocument[];
  sales: Sale[];
}

export type InventoryAction =
  | { type: 'ADD_PRODUCT'; payload: ProductFormData }
  | { type: 'UPDATE_PRODUCT'; payload: { id: string; data: ProductFormData } }
  | { type: 'ARCHIVE_PRODUCT'; payload: { id: string } }
  | { type: 'ADD_INCOME_RECEIPT'; payload: IncomeReceiptFormData }
  | { type: 'ADD_OUTCOME_DOCUMENT'; payload: OutcomeFormData }
  | { type: 'ADD_SALE'; payload: SaleFormData };

export interface InventoryContextValue {
  products: Product[];
  activeProducts: Product[];
  movements: WarehouseMovement[];
  incomeReceipts: IncomeReceipt[];
  outcomeDocuments: OutcomeDocument[];
  sales: Sale[];
  getProductMovements: (productId: string) => WarehouseMovement[];
  getIncomeReceiptById: (id: string) => IncomeReceipt | undefined;
  getOutcomeDocumentById: (id: string) => OutcomeDocument | undefined;
  getSaleById: (id: string) => Sale | undefined;
  addProduct: (data: ProductFormData) => void;
  updateProduct: (
    id: string,
    data: ProductFormData
  ) => { success: boolean; error?: string; field?: 'stock' | 'purchasePrice' };
  archiveProduct: (id: string) => { success: boolean; error?: string };
  addIncomeReceipt: (
    data: IncomeReceiptFormData
  ) => { success: boolean; error?: string };
  addOutcomeDocument: (
    data: OutcomeFormData
  ) => { success: boolean; error?: string };
  addSale: (data: SaleFormData) => { success: boolean; error?: string };
}

export const InventoryContext = createContext<InventoryContextValue | null>(null);
