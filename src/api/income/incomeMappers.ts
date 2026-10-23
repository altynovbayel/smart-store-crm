import type {
  IncomeCatalogProduct,
  WarehouseCatalog,
  CreateIncomeReceiptInput,
  CreateIncomeReceiptRpcParams,
} from '../../types';
import { somToMinor } from '../../utils/moneyUtils';

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

/**
 * Maps a complete rpc_list_products catalog to the Income form products.
 * Income is admin-only: a cashier response or an admin row without a purchase price yields
 * null (the whole catalog is rejected; a missing price is never replaced with 0).
 */
export const mapCatalogToIncomeProducts = (
  catalog: WarehouseCatalog
): IncomeCatalogProduct[] | null => {
  if (catalog.role !== 'admin') return null;
  const products: IncomeCatalogProduct[] = [];
  for (const item of catalog.products) {
    if (item.purchasePrice === null) return null;
    products.push({
      id: item.id,
      sku: item.sku,
      name: item.name,
      sellingPrice: item.sellingPrice,
      stock: item.stock,
      unit: item.unit,
      purchasePrice: item.purchasePrice,
    });
  }
  return products;
};
