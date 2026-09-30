export interface IncomeReceiptItem {
  id: string;
  productId: string;
  productName: string;
  sku: string;
  quantity: number;
  purchasePrice: number;
  totalAmount: number;
}

export type IncomeReceiptStatus = 'completed';

export interface IncomeReceipt {
  id: string;
  receiptNumber: string;
  supplier: string;
  documentNumber: string;
  receivedAt: string;
  createdAt: string;
  responsiblePerson: string;
  comment?: string;
  items: IncomeReceiptItem[];
  totalQuantity: number;
  totalAmount: number;
  status: IncomeReceiptStatus;
}

export type IncomePeriodFilter = 'all' | 'today' | 'week' | 'month';

export interface IncomeFilters {
  searchQuery: string;
  period: IncomePeriodFilter;
}

export interface IncomeReceiptItemInput {
  productId: string;
  quantity: number;
  purchasePrice: number;
}

export interface IncomeReceiptFormData {
  supplier: string;
  documentNumber?: string;
  receivedAt: string;
  responsiblePerson: string;
  comment?: string;
  items: IncomeReceiptItemInput[];
}

export interface IncomeSummary {
  todayCount: number;
  todayUnits: number;
  todayAmount: number;
  suppliersCount: number;
}

export interface FormItemState {
  id: string;
  productId: string;
  rawQuantity: string;
  rawPurchasePrice: string;
}
