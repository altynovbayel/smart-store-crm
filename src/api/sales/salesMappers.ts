import type { Database } from '../../types/database.types';
import type {
  CreateSaleInput,
  SaleCatalogProduct,
  SaleItem,
  ServerDiscountType,
  WarehouseCatalogProduct,
} from '../../types';
import { PAYMENT_METHODS } from '../../types';
import { isValidUuid } from '../../utils/uuidUtils';
import {
  amountToMinor,
  calculateSaleMinorTotals,
  toServerDiscount,
  type SaleMinorIssue,
} from '../../utils/saleMinorCalculations';
import { SaleValidationError } from './salesValidationError';

/**
 * Narrows a role-aware catalog item (rpc_list_products) to the sale-form product. Fields are
 * copied explicitly, so an admin purchase price / description never enters the Sales state either.
 */
export const mapCatalogItemToSaleProduct = (item: WarehouseCatalogProduct): SaleCatalogProduct => ({
  id: item.id,
  sku: item.sku,
  barcode: item.barcode,
  name: item.name,
  category: item.category,
  categoryLabel: item.categoryLabel,
  sellingPrice: item.sellingPrice,
  stock: item.stock,
  minStockThreshold: item.minStockThreshold,
  status: item.status,
  isArchived: item.isArchived,
  unit: item.unit,
  iconType: item.iconType,
});

export type CreateSaleRpcArgs = Database['public']['Functions']['rpc_create_sale']['Args'];

/** One element of `p_items` exactly as read by rpc_create_sale (type alias keeps it assignable to Json). */
export type SaleRpcItem = {
  product_id: string;
  quantity: number;
  unit_price_minor: number;
  discount_type: ServerDiscountType;
  discount_value: number;
};

/**
 * Total sold units of a receipt (Σ quantity). `Sale.itemsCount` means UNITS across the app
 * (InventoryProvider, mock sales, sales tables, history statistics) — not the number of lines.
 * Non-safe-integer quantities are ignored so the sum can never become NaN or unsafe.
 */
export const sumSaleItemUnits = (items: readonly { quantity: number }[]): number => {
  let units = 0;
  for (const item of items) {
    if (Number.isSafeInteger(item.quantity) && item.quantity > 0) {
      const next = units + item.quantity;
      if (!Number.isSafeInteger(next)) return units;
      units = next;
    }
  }
  return units;
};

/** "First line name" or "First line name +N" (N = number of other lines), as in InventoryProvider. */
export const buildPrimaryProductName = (items: readonly Pick<SaleItem, 'productName'>[]): string | undefined => {
  const first = items[0]?.productName;
  if (!first) return undefined;
  return items.length > 1 ? `${first} +${items.length - 1}` : first;
};

const ISSUE_MESSAGES: Record<SaleMinorIssue, { message: string; field: string }> = {
  quantity: {
    message: 'Количество товара должно быть целым положительным числом не более 100 000 000 шт.',
    field: 'itemsGeneral',
  },
  unit_price: { message: 'Цена продажи должна быть от 0 до 100 000 000 сом.', field: 'itemsGeneral' },
  line_bounds: { message: 'Сумма строки превышает допустимый математический предел.', field: 'itemsGeneral' },
  item_discount_bounds: {
    message: 'Скидка на позицию должна быть от 0 до 100% или не больше суммы строки.',
    field: 'itemsGeneral',
  },
  item_discount_exceeds_line: {
    message: 'Скидка на позицию не может превышать сумму строки.',
    field: 'itemsGeneral',
  },
  document_bounds: { message: 'Сумма чека превышает допустимый математический предел.', field: 'totalAmount' },
  receipt_discount_bounds: {
    message: 'Скидка на чек должна быть от 0 до 100%.',
    field: 'receiptDiscount',
  },
  receipt_discount_full_percent: {
    message: 'Скидка на чек 100% недопустима: итог продажи должен быть больше 0 сом.',
    field: 'receiptDiscount',
  },
  receipt_discount_exceeds_total: {
    message: 'Фиксированная скидка на чек должна быть меньше суммы товаров.',
    field: 'receiptDiscount',
  },
  total_not_positive: { message: 'Итоговая сумма продажи должна быть больше 0 сом.', field: 'totalAmount' },
  received_missing: { message: 'Укажите сумму, полученную от покупателя.', field: 'receivedAmount' },
  received_less_than_total: {
    message: 'Полученная сумма меньше итога к оплате.',
    field: 'receivedAmount',
  },
  received_bounds: { message: 'Полученная сумма превышает допустимый предел.', field: 'receivedAmount' },
};

/**
 * Maps a validated sale into strict arguments for `rpc_create_sale`.
 * - Requires a strict UUID idempotency key for `p_id`.
 * - Amounts → integer tyiyns; percent discounts → basis points (10 % = 1000); zero discounts → 'none'.
 * - `unit_price_minor` is the catalog price the user confirmed; the server rejects any mismatch (SSP01).
 * - Re-validates every amount with the exact SQL algorithm before the network call.
 * Throws SaleValidationError with a user-facing message on invalid input.
 */
export const mapSaleFormToRpcArgs = (input: CreateSaleInput): CreateSaleRpcArgs => {
  if (!isValidUuid(input.id)) {
    throw new SaleValidationError(
      'Внутренняя ошибка: отсутствует корректный идентификатор продажи. Закройте форму и оформите продажу заново.'
    );
  }

  if (!PAYMENT_METHODS[input.paymentMethod]) {
    throw new SaleValidationError('Выберите способ оплаты.', 'paymentMethod');
  }

  if (!Array.isArray(input.items) || input.items.length === 0) {
    throw new SaleValidationError('Добавьте хотя бы один товар в чек.', 'itemsGeneral');
  }

  const seenProductIds = new Set<string>();
  const rpcItems: SaleRpcItem[] = [];

  for (const item of input.items) {
    const productId = item.productId.trim();
    if (!isValidUuid(productId)) {
      throw new SaleValidationError('Укажите корректный товар для каждой позиции чека.', 'itemsGeneral');
    }
    if (seenProductIds.has(productId)) {
      throw new SaleValidationError(
        'В чеке содержатся повторяющиеся товары. Объедините позиции.',
        'itemsGeneral'
      );
    }
    seenProductIds.add(productId);

    const unitPriceMinor = amountToMinor(item.unitPrice);
    if (unitPriceMinor === null) {
      throw new SaleValidationError(ISSUE_MESSAGES.unit_price.message, 'itemsGeneral');
    }

    const discount = toServerDiscount(item.discountType, item.discountValue);
    if (discount === null) {
      throw new SaleValidationError(ISSUE_MESSAGES.item_discount_bounds.message, 'itemsGeneral');
    }

    rpcItems.push({
      product_id: productId,
      quantity: item.quantity,
      unit_price_minor: unitPriceMinor,
      discount_type: discount.type,
      discount_value: discount.value,
    });
  }

  const receiptDiscount = toServerDiscount(input.receiptDiscountType, input.receiptDiscountValue);
  if (receiptDiscount === null) {
    throw new SaleValidationError(ISSUE_MESSAGES.receipt_discount_bounds.message, 'receiptDiscount');
  }

  let receivedMinor: number | null = null;
  if (input.paymentMethod === 'cash') {
    if (input.receivedAmount === undefined) {
      throw new SaleValidationError(ISSUE_MESSAGES.received_missing.message, 'receivedAmount');
    }
    receivedMinor = amountToMinor(input.receivedAmount);
    if (receivedMinor === null) {
      throw new SaleValidationError('Введите корректную полученную сумму.', 'receivedAmount');
    }
  }

  const totals = calculateSaleMinorTotals(
    rpcItems.map((it) => ({
      quantity: it.quantity,
      unitPriceMinor: it.unit_price_minor,
      discount: { type: it.discount_type, value: it.discount_value },
    })),
    receiptDiscount,
    input.paymentMethod,
    receivedMinor
  );
  if (!totals.ok) {
    const issue = ISSUE_MESSAGES[totals.issue];
    throw new SaleValidationError(issue.message, issue.field);
  }

  let soldAtIso: string;
  if (input.soldAt) {
    const parsed = new Date(input.soldAt);
    if (isNaN(parsed.getTime())) {
      throw new SaleValidationError('Некорректная дата и время продажи.', 'soldAt');
    }
    if (parsed.getTime() > Date.now()) {
      throw new SaleValidationError('Дата продажи не может быть в будущем.', 'soldAt');
    }
    soldAtIso = parsed.toISOString();
  } else {
    soldAtIso = new Date().toISOString();
  }

  const args: CreateSaleRpcArgs = {
    p_payment_method: input.paymentMethod,
    p_receipt_discount_type: receiptDiscount.type,
    p_receipt_discount_value: receiptDiscount.value,
    p_sold_at: soldAtIso,
    p_items: rpcItems,
    p_id: input.id,
  };

  const comment = input.comment?.trim();
  if (comment) {
    args.p_comment = comment;
  }
  // Card / transfer: p_received_minor is omitted (DEFAULT NULL), as required by sales_cash_payment_consistency
  if (receivedMinor !== null) {
    args.p_received_minor = receivedMinor;
  }

  return args;
};
