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

export interface MappedIncomeError {
  message: string;
  field?: string;
  isNetworkError?: boolean;
  isAuthError?: boolean;
}

export type IncomeApiResult<T> =
  | { success: true; data: T }
  | { success: false; error: MappedIncomeError };

export type CreateIncomeReceiptRpcItem = {
  [key: string]: string | number;
  product_id: string;
  quantity: number;
  purchase_price_minor: number;
};

export interface CreateIncomeReceiptRpcParams {
  p_supplier: string;
  p_supplier_document_number?: string;
  p_received_at?: string;
  p_comment?: string;
  p_items: CreateIncomeReceiptRpcItem[];
  p_id?: string;
}

export interface CreateIncomeReceiptInput {
  id?: string;
  supplier: string;
  documentNumber?: string;
  receivedAt?: string;
  responsiblePerson?: string;
  comment?: string;
  items: IncomeReceiptItemInput[];
}

export interface CreateIncomeReceiptResult {
  id: string;
  receiptNumber: string;
  totalAmount: number;
  itemsCount: number;
}

export interface FetchIncomeReceiptsResult {
  receipts: IncomeReceipt[];
  isTruncated: boolean;
  totalFetched: number;
}

export interface PendingIncomeOperation {
  id: string;
  userId: string;
  payload: IncomeReceiptFormData;
  submittedAt: string;
}
