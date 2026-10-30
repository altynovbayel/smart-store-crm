/**
 * Utility functions for income form numeric parsing and financial calculations.
 * Uses integer cents arithmetic to completely eliminate IEEE-754 floating point
 * rounding errors and strictly respects Number.MAX_SAFE_INTEGER limits.
 */

import type { FormItemState, IncomeCatalogProduct, ProductLineAddResult } from '../types';

export const MAX_SAFE_PRICE = 100_000_000; // Max unit purchase price: 100 000 000 som

export const toCents = (amount: number): number => Math.round(amount * 100);
export const fromCents = (cents: number): number => cents / 100;

export const parseItemQuantity = (rawQuantity: string): number | null => {
  const trimmed = rawQuantity.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const num = Number(trimmed);
  return Number.isSafeInteger(num) && num > 0 ? num : null;
};

export const parseItemPrice = (rawPrice: string): number | null => {
  const trimmed = rawPrice.trim().replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  const num = Number(trimmed);
  return Number.isFinite(num) && num >= 0 && num <= MAX_SAFE_PRICE ? num : null;
};

export const calculateItemSubtotal = (
  rawQuantity: string,
  rawPurchasePrice: string
): number | null => {
  const qty = parseItemQuantity(rawQuantity);
  const price = parseItemPrice(rawPurchasePrice);
  if (qty === null || price === null) return null;
  const priceCents = toCents(price);
  const totalCents = qty * priceCents;
  if (!Number.isSafeInteger(totalCents)) return null;
  return fromCents(totalCents);
};

/** Refusal of a rescan while the existing line holds an invalid quantity (shared by Outcome). */
export const invalidLineQuantityMessage = (productName: string): string =>
  `Исправьте количество товара «${productName}» в документе, затем отсканируйте снова`;

/** Max quantity of one receipt line (same bound as the form validation). */
export const MAX_INCOME_ITEM_QUANTITY = 1_000_000;

/**
 * Adds a scanned / selected product to the receipt lines without creating duplicates:
 * - already in the receipt: quantity + 1, the entered purchase price is kept;
 * - an empty manual row exists: it is filled (quantity 1, catalog purchase price);
 * - otherwise a new row (quantity 1, catalog purchase price — same default as choosing the
 *   product in a row's select).
 */
export const addIncomeProductLine = (
  items: readonly FormItemState[],
  product: IncomeCatalogProduct,
  newRowId: string
): ProductLineAddResult<FormItemState> => {
  const existing = items.find((it) => it.productId === product.id);
  if (existing) {
    // An empty quantity counts as 0; an invalid one is never silently replaced
    const currentQty = existing.rawQuantity.trim()
      ? parseItemQuantity(existing.rawQuantity)
      : 0;
    if (currentQty === null) {
      return { ok: false, error: invalidLineQuantityMessage(product.name) };
    }
    const nextQty = currentQty + 1;
    if (nextQty > MAX_INCOME_ITEM_QUANTITY) {
      return {
        ok: false,
        error: `Количество товара «${product.name}» не может превышать 1 000 000`,
      };
    }
    return {
      ok: true,
      items: items.map((it) =>
        it.id === existing.id ? { ...it, rawQuantity: String(nextQty) } : it
      ),
      message: `Количество увеличено: ${product.name} — ${nextQty} ${product.unit}`,
    };
  }

  const line = {
    productId: product.id,
    rawQuantity: '1',
    rawPurchasePrice: String(product.purchasePrice),
  };
  const emptyRow = items.find((it) => !it.productId);
  return {
    ok: true,
    items: emptyRow
      ? items.map((it) => (it.id === emptyRow.id ? { ...it, ...line } : it))
      : [...items, { id: newRowId, ...line }],
    message: `Товар добавлен: ${product.name}`,
  };
};

export interface IncomeTotals {
  totalUnits: number;
  totalAmount: number;
  isOverflow: boolean;
}

export const calculateIncomeTotals = (
  items: Array<{ rawQuantity: string; rawPurchasePrice: string }>
): IncomeTotals => {
  let totalUnits = 0;
  let totalCents = 0;
  let isOverflow = false;

  for (const it of items) {
    const q = parseItemQuantity(it.rawQuantity);
    const p = parseItemPrice(it.rawPurchasePrice);
    if (q !== null) {
      totalUnits += q;
      if (p !== null) {
        const lineCents = q * toCents(p);
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
  }

  return {
    totalUnits,
    totalAmount: isOverflow ? 0 : fromCents(totalCents),
    isOverflow,
  };
};

import { isToday, isWithinDays } from './dateUtils';

export const calculateIncomeSummaryStats = (
  receipts: import('../types').IncomeReceipt[],
  currentDateKey: string
): import('../types').IncomeSummary => {
  let todayCount = 0;
  let todayUnits = 0;
  let todayAmount = 0;
  const suppliers = new Set<string>();

  for (const receipt of receipts) {
    if (receipt.supplier.trim()) {
      suppliers.add(receipt.supplier.trim().toLowerCase());
    }
    if (isToday(receipt.receivedAt, currentDateKey)) {
      todayCount += 1;
      todayUnits += receipt.totalQuantity;
      todayAmount += receipt.totalAmount;
    }
  }

  return {
    todayCount,
    todayUnits,
    todayAmount,
    suppliersCount: suppliers.size,
  };
};

export const filterIncomeReceipts = (
  receipts: import('../types').IncomeReceipt[],
  filters: import('../types').IncomeFilters,
  currentDateKey: string
): import('../types').IncomeReceipt[] => {
  return receipts.filter((receipt) => {
    // 1. Search Query
    if (filters.searchQuery.trim()) {
      const q = filters.searchQuery.trim().toLowerCase();
      const matchNumber = receipt.receiptNumber.toLowerCase().includes(q);
      const matchSupplier = receipt.supplier.toLowerCase().includes(q);
      const matchDoc = receipt.documentNumber.toLowerCase().includes(q);
      if (!matchNumber && !matchSupplier && !matchDoc) {
        return false;
      }
    }

    // 2. Period Filter
    if (filters.period === 'today') {
      if (!isToday(receipt.receivedAt, currentDateKey)) return false;
    } else if (filters.period === 'week') {
      if (!isWithinDays(receipt.receivedAt, 7, currentDateKey)) return false;
    } else if (filters.period === 'month') {
      if (!isWithinDays(receipt.receivedAt, 30, currentDateKey)) return false;
    }

    return true;
  });
};
