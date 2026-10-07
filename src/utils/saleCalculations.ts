import type {
  DiscountType,
  PaymentMethod,
  Product,
  SaleFormData,
  SaleFormItemState,
  SaleItemCalculations,
  SaleTotals,
  SaleValidationResult,
  BarcodeScanResult,
} from '../types';
import { parseCustomDate } from './dateUtils';
import { toCents, fromCents } from './incomeCalculations';

export const MAX_SAFE_PRICE = 100_000_000;

export const parseSaleQuantity = (rawQuantity: string): number | null => {
  const trimmed = rawQuantity.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const num = Number(trimmed);
  return Number.isSafeInteger(num) && num > 0 ? num : null;
};

export const parseSalePrice = (rawPrice: string): number | null => {
  const trimmed = rawPrice.trim().replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  const num = Number(trimmed);
  return Number.isFinite(num) && num >= 0 && num <= MAX_SAFE_PRICE ? num : null;
};

export const parseSaleReceivedAmount = (rawAmount: string): number | null => {
  const trimmed = rawAmount.trim().replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  const num = Number(trimmed);
  if (!Number.isFinite(num) || num < 0) return null;
  const cents = toCents(num);
  return Number.isSafeInteger(cents) ? num : null;
};

export const parseSaleDiscountValue = (
  rawDiscount: string,
  type: DiscountType
): number | null => {
  const trimmed = rawDiscount.trim().replace(',', '.');
  if (!trimmed) return 0;
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  const num = Number(trimmed);
  if (!Number.isFinite(num) || num < 0) return null;

  if (type === 'percent') {
    return num <= 100 ? num : null;
  }
  return num <= MAX_SAFE_PRICE ? num : null;
};

export type { SaleItemCalculations };

/**
 * Calculates discount amount in integer cents from gross amount in cents and percentage discount.
 * Uses basis points (hundredths of a percent) with BigInt integer division
 * to eliminate IEEE-754 precision issues (e.g. 250 cents * 64.6% -> exact 161.5 cents -> 162 cents).
 */
export const calculatePercentDiscountCents = (
  baseCents: number,
  percentValue: number
): number => {
  if (baseCents <= 0 || percentValue <= 0) return 0;
  if (percentValue >= 100) return baseCents;
  const percentBps = Math.round(percentValue * 100);
  const product = BigInt(baseCents) * BigInt(percentBps);
  const discountCentsBig = (product + 5000n) / 10000n;
  const discountCents = Number(discountCentsBig);
  return Math.max(0, Math.min(baseCents, discountCents));
};

export const calculateSaleItemSubtotals = (
  rawQuantity: string,
  rawUnitPrice: string,
  purchasePriceSnapshot: number,
  discountType: DiscountType,
  rawDiscountValue: string
): SaleItemCalculations | null => {
  const qty = parseSaleQuantity(rawQuantity);
  const unitPrice = parseSalePrice(rawUnitPrice);
  const discountVal = parseSaleDiscountValue(rawDiscountValue, discountType);

  if (
    qty === null ||
    unitPrice === null ||
    discountVal === null ||
    !Number.isFinite(purchasePriceSnapshot) ||
    purchasePriceSnapshot < 0
  ) {
    return null;
  }

  const unitPriceCents = toCents(unitPrice);
  const costPriceCents = toCents(purchasePriceSnapshot);

  const lineGrossCents = qty * unitPriceCents;
  if (!Number.isSafeInteger(lineGrossCents)) return null;

  let lineDiscountCents = 0;
  if (discountType === 'percent') {
    lineDiscountCents = calculatePercentDiscountCents(lineGrossCents, discountVal);
  } else {
    lineDiscountCents = toCents(discountVal);
  }

  // Discount cannot exceed line gross amount
  lineDiscountCents = Math.max(0, Math.min(lineGrossCents, lineDiscountCents));
  if (!Number.isSafeInteger(lineDiscountCents)) return null;

  const lineFinalCents = lineGrossCents - lineDiscountCents;
  const lineCostCents = qty * costPriceCents;
  if (!Number.isSafeInteger(lineCostCents)) return null;

  const lineProfitCents = lineFinalCents - lineCostCents;

  return {
    quantity: qty,
    unitPrice,
    grossAmount: fromCents(lineGrossCents),
    discountAmount: fromCents(lineDiscountCents),
    finalAmount: fromCents(lineFinalCents),
    costAmount: fromCents(lineCostCents),
    profitAmount: fromCents(lineProfitCents),
    grossCents: lineGrossCents,
    discountCents: lineDiscountCents,
    finalCents: lineFinalCents,
    costCents: lineCostCents,
    profitCents: lineProfitCents,
  };
};

export type { SaleTotals };

export const calculateSaleTotals = (
  items: SaleFormItemState[],
  activeProducts: Product[],
  receiptDiscountType: DiscountType,
  rawReceiptDiscountValue: string,
  paymentMethod: PaymentMethod,
  rawReceivedAmount: string
): SaleTotals => {
  let totalUnits = 0;
  let subtotalCents = 0;
  let itemDiscountTotalCents = 0;
  let itemsFinalCents = 0;
  let costCents = 0;
  let isOverflow = false;

  for (const it of items) {
    const prod = activeProducts.find((p) => p.id === it.productId);
    const costPrice = prod ? prod.purchasePrice : 0;
    const itemCalc = calculateSaleItemSubtotals(
      it.rawQuantity,
      it.rawUnitPrice,
      costPrice,
      it.discountType,
      it.rawDiscountValue
    );

    if (itemCalc) {
      totalUnits += itemCalc.quantity;
      const gCents = itemCalc.grossCents;
      const dCents = itemCalc.discountCents;
      const fCents = itemCalc.finalCents;
      const cCents = itemCalc.costCents;

      if (
        !Number.isSafeInteger(subtotalCents + gCents) ||
        !Number.isSafeInteger(itemDiscountTotalCents + dCents) ||
        !Number.isSafeInteger(itemsFinalCents + fCents) ||
        !Number.isSafeInteger(costCents + cCents)
      ) {
        isOverflow = true;
      } else {
        subtotalCents += gCents;
        itemDiscountTotalCents += dCents;
        itemsFinalCents += fCents;
        costCents += cCents;
      }
    } else {
      const qty = parseSaleQuantity(it.rawQuantity);
      const unitPrice = parseSalePrice(it.rawUnitPrice);
      if (qty !== null && unitPrice !== null) {
        const lineGrossCents = qty * toCents(unitPrice);
        const lineCostCents = qty * toCents(costPrice);
        if (!Number.isSafeInteger(lineGrossCents) || !Number.isSafeInteger(lineCostCents)) {
          isOverflow = true;
        }
      }
    }
  }

  // Receipt discount calculation
  let receiptDiscountCents = 0;
  const parsedReceiptDiscount = parseSaleDiscountValue(
    rawReceiptDiscountValue,
    receiptDiscountType
  );

  if (parsedReceiptDiscount !== null && parsedReceiptDiscount > 0) {
    if (receiptDiscountType === 'percent') {
      receiptDiscountCents = calculatePercentDiscountCents(
        itemsFinalCents,
        parsedReceiptDiscount
      );
    } else {
      receiptDiscountCents = toCents(parsedReceiptDiscount);
    }
    receiptDiscountCents = Math.max(
      0,
      Math.min(itemsFinalCents, receiptDiscountCents)
    );
  }

  const totalAmountCents = Math.max(0, itemsFinalCents - receiptDiscountCents);
  const profitCents = totalAmountCents - costCents;

  if (
    !Number.isSafeInteger(totalAmountCents) ||
    !Number.isSafeInteger(profitCents)
  ) {
    isOverflow = true;
  }

  // Cash change calculation
  let changeAmount = 0;
  if (paymentMethod === 'cash') {
    const received = parseSaleReceivedAmount(rawReceivedAmount);
    if (received !== null) {
      const recCents = toCents(received);
      if (
        recCents >= totalAmountCents &&
        Number.isSafeInteger(recCents - totalAmountCents)
      ) {
        changeAmount = fromCents(recCents - totalAmountCents);
      }
    }
  }

  return {
    totalUnits,
    subtotal: isOverflow ? 0 : fromCents(subtotalCents),
    itemDiscountTotal: isOverflow ? 0 : fromCents(itemDiscountTotalCents),
    itemsFinal: isOverflow ? 0 : fromCents(itemsFinalCents),
    receiptDiscountAmount: isOverflow ? 0 : fromCents(receiptDiscountCents),
    totalAmount: isOverflow ? 0 : fromCents(totalAmountCents),
    costAmount: isOverflow ? 0 : fromCents(costCents),
    profitAmount: isOverflow ? 0 : fromCents(profitCents),
    changeAmount: isOverflow ? 0 : changeAmount,
    isOverflow,
  };
};

export type { SaleValidationResult };

export const validateSaleForm = (
  soldAt: string,
  paymentMethod: PaymentMethod,
  rawReceivedAmount: string,
  responsiblePerson: string,
  comment: string,
  receiptDiscountType: DiscountType,
  rawReceiptDiscountValue: string,
  items: SaleFormItemState[],
  activeProducts: Product[]
): SaleValidationResult => {
  const errors: Record<string, string> = {};

  if (!soldAt) {
    errors.soldAt = 'Укажите дату и время продажи';
  } else {
    const parsedDate = parseCustomDate(soldAt);
    if (!parsedDate || isNaN(parsedDate.getTime())) {
      errors.soldAt = 'Некорректная дата и время продажи';
    } else if (parsedDate.getTime() > Date.now()) {
      errors.soldAt = 'Дата продажи не может быть в будущем';
    }
  }

  if (!paymentMethod) {
    errors.paymentMethod = 'Выберите способ оплаты';
  }

  if (!responsiblePerson.trim()) {
    errors.responsiblePerson = 'Укажите ответственного сотрудника';
  }

  if (items.length === 0) {
    errors.itemsGeneral = 'Добавьте хотя бы один товар в чек';
  }

  const seenProductIds = new Set<string>();
  const validatedItems: SaleFormData['items'] = [];
  let subtotalCents = 0;
  let itemsFinalCents = 0;
  let totalCostCents = 0;

  items.forEach((it, index) => {
    const rowNum = index + 1;

    if (!it.productId) {
      errors[`item-${it.id}-product`] = `Строка ${rowNum}: выберите товар`;
      return;
    }

    if (seenProductIds.has(it.productId)) {
      errors[`item-${it.id}-product`] = `Строка ${rowNum}: товар уже добавлен в другой строке`;
      return;
    }
    seenProductIds.add(it.productId);

    const product = activeProducts.find((p) => p.id === it.productId);
    if (!product || product.isArchived) {
      errors[`item-${it.id}-product`] = `Строка ${rowNum}: товар не найден или архивирован`;
      return;
    }

    // Stock check
    if (product.stock <= 0) {
      errors[`item-${it.id}-qty`] = `Строка ${rowNum}: товар отсутствует на складе (остаток 0)`;
      return;
    }

    const qty = parseSaleQuantity(it.rawQuantity);
    if (qty === null) {
      errors[`item-${it.id}-qty`] = `Строка ${rowNum}: введите целое положительное число`;
      return;
    }

    if (qty > product.stock) {
      errors[`item-${it.id}-qty`] = `Строка ${rowNum}: количество (${qty}) превышает остаток (${product.stock} ${product.unit})`;
      return;
    }

    const unitPrice = parseSalePrice(it.rawUnitPrice);
    if (unitPrice === null) {
      errors[`item-${it.id}-price`] = `Строка ${rowNum}: укажите корректную цену продажи`;
      return;
    }

    const discountVal = parseSaleDiscountValue(it.rawDiscountValue, it.discountType);
    if (discountVal === null) {
      errors[`item-${it.id}-discount`] =
        it.discountType === 'percent'
          ? `Строка ${rowNum}: скидка от 0 до 100%`
          : `Строка ${rowNum}: введите корректный размер скидки`;
      return;
    }

    const lineGrossCents = qty * toCents(unitPrice);
    if (
      !Number.isSafeInteger(lineGrossCents) ||
      !Number.isSafeInteger(subtotalCents + lineGrossCents)
    ) {
      errors[`item-${it.id}-price`] = `Строка ${rowNum}: сумма превышает допустимый предел`;
      return;
    }

    let lineDiscountCents = 0;
    if (it.discountType === 'percent') {
      lineDiscountCents = calculatePercentDiscountCents(lineGrossCents, discountVal);
    } else {
      lineDiscountCents = toCents(discountVal);
    }

    if (lineDiscountCents > lineGrossCents) {
      errors[`item-${it.id}-discount`] = `Строка ${rowNum}: скидка не может превышать сумму строки`;
      return;
    }

    const lineFinalCents = lineGrossCents - lineDiscountCents;
    if (!Number.isSafeInteger(itemsFinalCents + lineFinalCents)) {
      errors[`item-${it.id}-price`] = `Строка ${rowNum}: сумма превышает математический предел`;
      return;
    }

    const costPriceCents = toCents(product.purchasePrice);
    const lineCostCents = qty * costPriceCents;
    if (
      !Number.isSafeInteger(lineCostCents) ||
      !Number.isSafeInteger(totalCostCents + lineCostCents)
    ) {
      errors[`item-${it.id}-qty`] = `Строка ${rowNum}: себестоимость превышает математический предел`;
      return;
    }

    subtotalCents += lineGrossCents;
    itemsFinalCents += lineFinalCents;
    totalCostCents += lineCostCents;

    validatedItems.push({
      productId: product.id,
      quantity: qty,
      unitPrice,
      discountType: it.discountType,
      discountValue: discountVal,
    });
  });

  // Receipt discount validation
  const parsedReceiptDiscount = parseSaleDiscountValue(
    rawReceiptDiscountValue,
    receiptDiscountType
  );
  if (parsedReceiptDiscount === null) {
    errors.receiptDiscount =
      receiptDiscountType === 'percent'
        ? 'Скидка на чек должна быть от 0 до 100%'
        : 'Введите корректный размер скидки на чек';
  }

  let receiptDiscountCents = 0;
  if (parsedReceiptDiscount !== null && parsedReceiptDiscount > 0) {
    if (receiptDiscountType === 'percent') {
      receiptDiscountCents = calculatePercentDiscountCents(
        itemsFinalCents,
        parsedReceiptDiscount
      );
    } else {
      receiptDiscountCents = toCents(parsedReceiptDiscount);
    }

    if (receiptDiscountCents > itemsFinalCents) {
      errors.receiptDiscount = 'Скидка на чек не может превышать сумму товаров';
    }
  }

  const totalAmountCents = itemsFinalCents - receiptDiscountCents;
  if (items.length > 0 && totalAmountCents <= 0) {
    errors.totalAmount = 'Итоговая сумма продажи должна быть больше 0 сом';
  }

  const profitCents = totalAmountCents - totalCostCents;
  if (!Number.isSafeInteger(totalAmountCents) || !Number.isSafeInteger(profitCents)) {
    errors.totalAmount = 'Расчёт прибыли чека превышает допустимый математический предел';
  }

  // Cash payment validation
  let validatedReceivedAmount: number | undefined;
  if (paymentMethod === 'cash') {
    const trimmedReceived = rawReceivedAmount.trim();
    if (!trimmedReceived) {
      errors.receivedAmount = 'Укажите сумму, полученную от покупателя';
    } else {
      const received = parseSaleReceivedAmount(trimmedReceived);
      if (received === null) {
        errors.receivedAmount = 'Введите корректную сумму';
      } else {
        const recCents = toCents(received);
        if (recCents < totalAmountCents) {
          errors.receivedAmount = `Полученная сумма (${received} сом) меньше итога (${fromCents(totalAmountCents)} сом)`;
        } else if (!Number.isSafeInteger(recCents - totalAmountCents)) {
          errors.receivedAmount = 'Сумма сдачи превышает допустимый математический предел';
        } else {
          validatedReceivedAmount = received;
        }
      }
    }
  }

  const isValid =
    Object.keys(errors).length === 0 && validatedItems.length === items.length;

  if (!isValid) {
    return { isValid: false, errors };
  }

  return {
    isValid: true,
    errors: {},
    data: {
      soldAt,
      paymentMethod,
      receivedAmount: validatedReceivedAmount,
      responsiblePerson: responsiblePerson.trim(),
      comment: comment.trim() || undefined,
      receiptDiscountType,
      receiptDiscountValue: parsedReceiptDiscount ?? 0,
      items: validatedItems,
    },
  };
};

export type { BarcodeScanResult };

/**
 * Finds and adds or increments a product in sale items by barcode.
 */
export const processBarcodeScan = (
  rawBarcode: string,
  catalog: readonly Product[],
  currentItems: readonly SaleFormItemState[]
): BarcodeScanResult => {
  const normalizedBarcode = rawBarcode.trim();
  if (!normalizedBarcode) {
    return { success: false };
  }

  const matches = catalog.filter((p) => p.barcode.trim() === normalizedBarcode);

  if (matches.length > 1) {
    return {
      success: false,
      error: 'Обнаружено несколько товаров с одинаковым штрихкодом. Проверьте справочник номенклатуры.',
    };
  }

  if (matches.length === 0) {
    return {
      success: false,
      error: 'Товар с таким штрихкодом не найден',
    };
  }

  const product = matches[0];

  if (product.isArchived) {
    return {
      success: false,
      error: 'Товар находится в архиве',
    };
  }

  if (product.stock <= 0) {
    return {
      success: false,
      error: 'Товара нет в наличии',
    };
  }

  const existingIndex = currentItems.findIndex(
    (it) => it.productId === product.id
  );

  if (existingIndex !== -1) {
    const existing = currentItems[existingIndex];
    const parsedQty = parseSaleQuantity(existing.rawQuantity) ?? 0;
    const nextQty = parsedQty + 1;

    if (nextQty > product.stock) {
      return {
        success: false,
        error: `Нельзя добавить больше: доступно ${product.stock} шт.`,
      };
    }

    const updatedItems = currentItems.map((it, idx) =>
      idx === existingIndex ? { ...it, rawQuantity: String(nextQty) } : it
    );

    return {
      success: true,
      product,
      updatedItems,
      message: `${product.name} добавлен в чек (всего ${nextQty} шт.)`,
    };
  }

  // Not in items yet
  if (product.stock < 1) {
    return {
      success: false,
      error: 'Товара нет в наличии',
    };
  }

  // If there's an empty row without product selected, populate it
  const emptyRowIndex = currentItems.findIndex((it) => !it.productId);

  if (emptyRowIndex !== -1) {
    const targetRow = currentItems[emptyRowIndex];
    const newItem: SaleFormItemState = {
      ...targetRow,
      productId: product.id,
      rawQuantity: '1',
      rawUnitPrice: String(product.sellingPrice),
      discountType: 'fixed',
      rawDiscountValue: '',
    };
    const updatedItems = currentItems.map((it, idx) =>
      idx === emptyRowIndex ? newItem : it
    );
    return {
      success: true,
      product,
      updatedItems,
      message: `${product.name} добавлен в чек`,
    };
  }

  // Otherwise append a new row
  const newItem: SaleFormItemState = {
    id: `row-${Date.now()}-${Math.random().toString(36).substring(2, 5)}`,
    productId: product.id,
    rawQuantity: '1',
    rawUnitPrice: String(product.sellingPrice),
    discountType: 'fixed',
    rawDiscountValue: '',
  };

  return {
    success: true,
    product,
    updatedItems: [...currentItems, newItem],
    message: `${product.name} добавлен в чек`,
  };
};
