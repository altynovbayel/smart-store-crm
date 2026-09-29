export type PaymentMethod = 'cash' | 'card' | 'transfer';
export type PaymentMethodLabel = 'Наличные' | 'Карта' | 'Перевод';

export type SaleStatus = 'completed' | 'pending' | 'cancelled';
export type SaleStatusLabel = 'Завершено' | 'В обработке' | 'Отменено';

export interface SaleItem {
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
}

export interface Sale {
  id: string;
  receiptNumber: string;
  createdAt: string;
  dateTimeFormatted: string;
  primaryProductName: string;
  itemsCount: number;
  totalAmount: number;
  paymentMethod: PaymentMethod;
  paymentMethodLabel: PaymentMethodLabel;
  status: SaleStatus;
  statusLabel: SaleStatusLabel;
}
