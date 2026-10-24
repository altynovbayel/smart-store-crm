import type {
  OutcomeDocument,
  OutcomeFilters,
  OutcomeFormData,
  OutcomeFormItemState,
  OutcomeReason,
  OutcomeSummary,
  Product,
  HistoricalPriceResult,
} from '../types';
import {
  parseCustomDate,
  normalizeDocumentTimestamp,
  isToday,
  isWithinDays,
} from './dateUtils';
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
  isAccurate: boolean;
}

export const calculateOutcomeTotals = (
  items: OutcomeFormItemState[],
  activeProducts: Product[],
  documentDate?: string,
  historicalPrices?: Record<string, HistoricalPriceResult>
): OutcomeTotals => {
  let totalUnits = 0;
  let totalCents = 0;
  let isOverflow = false;
  let isAccurate = Boolean(historicalPrices);

  const docTimestamp = normalizeDocumentTimestamp(documentDate);

  for (const it of items) {
    const q = parseOutcomeQuantity(it.rawQuantity);
    const product = activeProducts.find((p) => p.id === it.productId);
    if (q !== null && product) {
      totalUnits += q;
      let lineCents: number;

      if (historicalPrices) {
        const hist = historicalPrices[it.productId];
        if (hist) {
          lineCents = q * hist.purchasePriceMinor;
        } else {
          isAccurate = false;
          lineCents = q * toCents(product.purchasePrice);
        }
      } else {
        isAccurate = false;
        const purchasePrice = getHistoricalPurchasePrice(product, docTimestamp);
        lineCents = q * toCents(purchasePrice);
      }

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
    isAccurate,
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
  activeProducts: Product[],
  historicalPrices?: Record<string, HistoricalPriceResult>,
  isRetrySubmission = false
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
    if (!isRetrySubmission && (!product || product.isArchived)) {
      errors[`item-${it.id}-product`] = `Строка ${rowNum}: товар не найден или архивирован`;
      return;
    }

    // Check available stock (only for initial submissions; on retry of an unconfirmed operation, stock may have already been deducted on the server)
    if (!isRetrySubmission && product && product.stock <= 0) {
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

    if (!isRetrySubmission && product && q > product.stock) {
      errors[`item-${it.id}-qty`] = `Строка ${rowNum}: списание (${q}) превышает остаток (${product.stock} ${product.unit})`;
      return;
    }

    // Cost overflow is checked only against the price the RPC will actually use.
    // Without a resolved historical price (history not loaded) or on retry of an unconfirmed
    // operation, an approximate catalog price must not block submission: the server validates bounds.
    const resolvedPrice = historicalPrices?.[it.productId];
    const lineCents =
      resolvedPrice && !isRetrySubmission ? q * resolvedPrice.purchasePriceMinor : 0;

    if (
      !Number.isSafeInteger(lineCents) ||
      !Number.isSafeInteger(docTotalCents + lineCents)
    ) {
      errors[`item-${it.id}-qty`] = `Строка ${rowNum}: себестоимость превышает допустимый предел вычислений`;
      return;
    }

    docTotalCents += lineCents;
    validatedItems.push({
      productId: it.productId,
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

/**
 * Calculates aggregate stats across all loaded outcome documents.
 */
export const calculateOutcomeSummaryStats = (
  documents: OutcomeDocument[],
  currentDateKey: string
): OutcomeSummary => {
  let todayCount = 0;
  let todayUnits = 0;
  let todayCost = 0;
  let monthCount = 0;

  for (const doc of documents) {
    if (isToday(doc.documentDate, currentDateKey)) {
      todayCount += 1;
      todayUnits += doc.totalQuantity;
      todayCost += doc.totalCost;
    }
    if (isWithinDays(doc.documentDate, 30, currentDateKey)) {
      monthCount += 1;
    }
  }

  return {
    todayCount,
    todayUnits,
    todayCost,
    monthCount,
  };
};

/**
 * Filters outcome documents based on search query, reason, and period.
 */
export const filterOutcomeDocuments = (
  documents: OutcomeDocument[],
  filters: OutcomeFilters,
  currentDateKey: string
): OutcomeDocument[] => {
  return documents.filter((doc) => {
    // 1. Search Query (outcomeNumber, comment, item names, item SKUs)
    if (filters.searchQuery.trim()) {
      const q = filters.searchQuery.trim().toLowerCase();
      const matchNumber = doc.outcomeNumber.toLowerCase().includes(q);
      const matchComment = doc.comment ? doc.comment.toLowerCase().includes(q) : false;
      const matchItems = doc.items.some(
        (it) =>
          it.productName.toLowerCase().includes(q) ||
          it.sku.toLowerCase().includes(q)
      );
      if (!matchNumber && !matchComment && !matchItems) {
        return false;
      }
    }

    // 2. Reason Filter
    if (filters.reason !== 'all' && doc.reason !== filters.reason) {
      return false;
    }

    // 3. Period Filter
    if (filters.period === 'today') {
      if (!isToday(doc.documentDate, currentDateKey)) return false;
    } else if (filters.period === 'week') {
      if (!isWithinDays(doc.documentDate, 7, currentDateKey)) return false;
    } else if (filters.period === 'month') {
      if (!isWithinDays(doc.documentDate, 30, currentDateKey)) return false;
    }

    return true;
  });
};
