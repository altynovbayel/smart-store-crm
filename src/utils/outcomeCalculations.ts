import type {
  OutcomeFormData,
  OutcomeFormItemState,
  OutcomeReason,
  Product,
} from '../types';
import { parseCustomDate, normalizeDocumentTimestamp } from './dateUtils';
import { toCents, fromCents } from './incomeCalculations';
import { getHistoricalPurchasePrice } from './productUtils';

/**
 * Utility functions for outcome (write-off) calculations and form validations.
 * Isolates business logic and numerical validation outside of JSX components.
 */

export const parseOutcomeQuantity = (rawQuantity: string): number | null => {
  const trimmed = rawQuantity.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const num = Number(trimmed);
  return Number.isSafeInteger(num) && num > 0 ? num : null;
};

export const calculateOutcomeSubtotal = (
  rawQuantity: string,
  purchasePrice: number
): number | null => {
  const qty = parseOutcomeQuantity(rawQuantity);
  if (qty === null || !Number.isFinite(purchasePrice) || purchasePrice < 0) {
    return null;
  }
  const lineCents = qty * toCents(purchasePrice);
  if (!Number.isSafeInteger(lineCents)) return null;
  return fromCents(lineCents);
};

export interface OutcomeTotals {
  totalUnits: number;
  totalCost: number;
  isOverflow: boolean;
}

export const calculateOutcomeTotals = (
  items: OutcomeFormItemState[],
  activeProducts: Product[],
  documentDate?: string
): OutcomeTotals => {
  let totalUnits = 0;
  let totalCents = 0;
  let isOverflow = false;

  const docTimestamp = normalizeDocumentTimestamp(documentDate);

  for (const it of items) {
    const q = parseOutcomeQuantity(it.rawQuantity);
    const product = activeProducts.find((p) => p.id === it.productId);
    if (q !== null && product) {
      totalUnits += q;
      const purchasePrice = getHistoricalPurchasePrice(product, docTimestamp);
      const lineCents = q * toCents(purchasePrice);
      if (
        !Number.isSafeInteger(lineCents) ||
        !Number.isSafeInteger(totalCents + lineCents)
      ) {
        isOverflow = true;
      } else {
        totalCents += lineCents;
      }
    }
  }

  return {
    totalUnits,
    totalCost: isOverflow ? 0 : fromCents(totalCents),
    isOverflow,
  };
};

export interface ValidationResult {
  isValid: boolean;
  errors: Record<string, string>;
  data?: OutcomeFormData;
}

export const validateOutcomeForm = (
  reason: OutcomeReason,
  documentDate: string,
  responsiblePerson: string,
  comment: string,
  items: OutcomeFormItemState[],
  activeProducts: Product[]
): ValidationResult => {
  const errors: Record<string, string> = {};

  if (!reason) {
    errors.reason = 'Укажите причину списания';
  }

  if (reason === 'other' && !comment.trim()) {
    errors.comment = 'Для причины «Другое» комментарий обязателен';
  }

  if (!documentDate) {
    errors.documentDate = 'Укажите дату и время списания';
  } else {
    const parsedDate = parseCustomDate(documentDate);
    if (!parsedDate || isNaN(parsedDate.getTime())) {
      errors.documentDate = 'Некорректная дата и время списания';
    } else if (parsedDate.getTime() > Date.now()) {
      errors.documentDate = 'Дата списания не может быть в будущем';
    }
  }

  if (!responsiblePerson.trim()) {
    errors.responsiblePerson = 'Укажите ответственного сотрудника';
  }

  if (items.length === 0) {
    errors.itemsGeneral = 'Добавьте хотя бы одну позицию для списания';
  }

  const seenProductIds = new Set<string>();
  const validatedItems: OutcomeFormData['items'] = [];
  let docTotalCents = 0;

  items.forEach((it, index) => {
    const rowNum = index + 1;

    if (!it.productId) {
      errors[`item-${it.id}-product`] = `Строка ${rowNum}: выберите товар`;
      return;
    }

    if (seenProductIds.has(it.productId)) {
      errors[`item-${it.id}-product`] = `Строка ${rowNum}: товар уже выбран в другой строке`;
      return;
    }
    seenProductIds.add(it.productId);

    const product = activeProducts.find((p) => p.id === it.productId);
    if (!product || product.isArchived) {
      errors[`item-${it.id}-product`] = `Строка ${rowNum}: товар не найден или архивирован`;
      return;
    }

    // Check available stock
    if (product.stock <= 0) {
      errors[`item-${it.id}-qty`] = `Строка ${rowNum}: товар отсутствует на складе (остаток 0)`;
      return;
    }

    const trimmedQty = it.rawQuantity.trim();
    if (!trimmedQty) {
      errors[`item-${it.id}-qty`] = `Строка ${rowNum}: укажите количество`;
      return;
    }

    if (!/^\d+$/.test(trimmedQty)) {
      errors[`item-${it.id}-qty`] = `Строка ${rowNum}: введите целое положительное число`;
      return;
    }

    const q = Number(trimmedQty);
    if (!Number.isSafeInteger(q) || q <= 0) {
      errors[`item-${it.id}-qty`] = `Строка ${rowNum}: введите число больше 0`;
      return;
    }

    if (q > product.stock) {
      errors[`item-${it.id}-qty`] = `Строка ${rowNum}: списание (${q}) превышает остаток (${product.stock} ${product.unit})`;
      return;
    }

    const docTimestamp = normalizeDocumentTimestamp(documentDate);
    const purchasePrice = getHistoricalPurchasePrice(product, docTimestamp);
    const lineCents = q * toCents(purchasePrice);
    if (
      !Number.isSafeInteger(lineCents) ||
      !Number.isSafeInteger(docTotalCents + lineCents)
    ) {
      errors[`item-${it.id}-qty`] = `Строка ${rowNum}: себестоимость превышает допустимый предел вычислений`;
      return;
    }

    docTotalCents += lineCents;
    validatedItems.push({
      productId: product.id,
      quantity: q,
    });
  });

  const isValid = Object.keys(errors).length === 0 && validatedItems.length === items.length;

  if (!isValid) {
    return { isValid: false, errors };
  }

  const resolvedDate = new Date(normalizeDocumentTimestamp(documentDate)).toISOString();

  return {
    isValid: true,
    errors: {},
    data: {
      reason,
      documentDate: resolvedDate,
      responsiblePerson: responsiblePerson.trim(),
      comment: comment.trim() || undefined,
      items: validatedItems,
    },
  };
};
