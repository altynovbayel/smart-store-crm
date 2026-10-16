import type { Database } from '../../types/database.types';
import type {
  IncomeReceipt,
  IncomeReceiptItem,
  CreateIncomeReceiptInput,
  CreateIncomeReceiptRpcParams,
} from '../../types';
import { minorToSom, somToMinor } from '../../utils/moneyUtils';

export type IncomeReceiptRow = Database['public']['Tables']['income_receipts']['Row'];
export type IncomeItemRow = Database['public']['Tables']['income_items']['Row'];

export type IncomeReceiptWithItemsRow = IncomeReceiptRow & {
  items?: IncomeItemRow[] | null;
};

/**
 * Maps a Supabase income_items row to frontend IncomeReceiptItem type.
 */
export const mapIncomeItemRowToItem = (row: IncomeItemRow): IncomeReceiptItem => {
  const purchasePrice = minorToSom(row.purchase_price_minor);
  const totalAmount = minorToSom(row.subtotal_minor);
  const quantity = Number.isSafeInteger(row.quantity) && row.quantity > 0 ? row.quantity : 0;

  return {
    id: row.id,
    productId: row.product_id,
    productName: row.product_name_snapshot,
    sku: row.sku_snapshot,
    quantity,
    purchasePrice,
    totalAmount,
  };
};

/**
 * Maps a Supabase income_receipts row (with joined items) to frontend IncomeReceipt type.
 */
export const mapIncomeReceiptRowToReceipt = (row: IncomeReceiptWithItemsRow): IncomeReceipt => {
  const rawItems = Array.isArray(row.items) ? row.items : [];

  // Sort items deterministically by created_at ASC, id ASC
  const sortedItems = [...rawItems].sort((a, b) => {
    const timeA = new Date(a.created_at).getTime();
    const timeB = new Date(b.created_at).getTime();
    if (timeA !== timeB) return timeA - timeB;
    return a.id.localeCompare(b.id);
  });

  const items = sortedItems.map(mapIncomeItemRowToItem);
  const totalQuantity = items.reduce((sum, it) => sum + it.quantity, 0);
  const totalAmount = minorToSom(row.total_minor);

  return {
    id: row.id,
    receiptNumber: row.receipt_number,
    supplier: row.supplier,
    documentNumber: row.supplier_document_number ?? '',
    receivedAt: row.received_at,
    createdAt: row.created_at,
    responsiblePerson: row.created_by_name || 'Администратор',
    comment: row.comment ?? undefined,
    items,
    totalQuantity,
    totalAmount,
    status: 'completed',
  };
};

/**
 * Transforms create income receipt form input into rpc_create_income_receipt arguments.
 * Strictly validates quantities, safe integers, dates, and prices before calling RPC.
 */
export const mapIncomeReceiptFormToRpcArgs = (
  form: CreateIncomeReceiptInput
): CreateIncomeReceiptRpcParams => {
  const cleanSupplier = form.supplier?.trim();
  if (!cleanSupplier) {
    throw new Error('Укажите наименование поставщика');
  }

  if (!form.items || !Array.isArray(form.items) || form.items.length === 0) {
    throw new Error('Накладная должна содержать хотя бы одну позицию');
  }

  let receivedAtIso: string;
  if (form.receivedAt) {
    const cleanDate = form.receivedAt.trim();
    const parsedDate = new Date(cleanDate);
    if (isNaN(parsedDate.getTime())) {
      throw new Error('Некорректная дата и время поступления');
    }
    // Future date guard (allow 60s clock drift)
    if (parsedDate.getTime() > Date.now() + 60_000) {
      throw new Error('Дата прихода не может быть в будущем');
    }
    receivedAtIso = parsedDate.toISOString();
  } else {
    receivedAtIso = new Date().toISOString();
  }

  const seenProductIds = new Set<string>();
  const rpcItems = form.items.map((it, idx) => {
    const rowNum = idx + 1;
    const cleanProductId = it.productId?.trim();
    if (!cleanProductId) {
      throw new Error(`Строка ${rowNum}: выберите товар`);
    }
    if (seenProductIds.has(cleanProductId)) {
      throw new Error(`Строка ${rowNum}: товар уже выбран в другой строке`);
    }
    seenProductIds.add(cleanProductId);

    if (
      typeof it.quantity !== 'number' ||
      !Number.isSafeInteger(it.quantity) ||
      it.quantity <= 0
    ) {
      throw new Error(
        `Строка ${rowNum}: количество должно быть целым положительным числом`
      );
    }
    if (it.quantity > 1_000_000) {
      throw new Error(`Строка ${rowNum}: количество не может превышать 1 000 000`);
    }

    if (
      typeof it.purchasePrice !== 'number' ||
      !Number.isFinite(it.purchasePrice) ||
      it.purchasePrice < 0
    ) {
      throw new Error(
        `Строка ${rowNum}: закупочная цена должна быть неотрицательным числом`
      );
    }

    return {
      product_id: cleanProductId,
      quantity: it.quantity,
      purchase_price_minor: somToMinor(it.purchasePrice),
    };
  });

  return {
    p_id: form.id,
    p_supplier: cleanSupplier,
    p_supplier_document_number: form.documentNumber?.trim() || undefined,
    p_received_at: receivedAtIso,
    p_comment: form.comment?.trim() || undefined,
    p_items: rpcItems,
  };
};
