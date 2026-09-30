/**
 * Utility functions for income form numeric parsing and financial calculations.
 * Uses integer cents arithmetic to completely eliminate IEEE-754 floating point
 * rounding errors and strictly respects Number.MAX_SAFE_INTEGER limits.
 */

export const MAX_SAFE_PRICE = 10_000_000; // Max unit purchase price: 10 000 000 som

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
