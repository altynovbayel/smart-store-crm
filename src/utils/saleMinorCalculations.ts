import type { DiscountType, PaymentMethod, ServerDiscountType } from '../types';

/**
 * Exact integer (tyiyn) mirror of the monetary algorithm of `public.rpc_create_sale`.
 * Used to convert form values into RPC arguments and to pre-validate them with the
 * same bounds and rounding as PostgreSQL. The server always recalculates and is authoritative.
 */

export const MAX_SAFE_MINOR = Number.MAX_SAFE_INTEGER; // 9 007 199 254 740 991
export const MAX_UNIT_PRICE_MINOR = 10_000_000_000; // 100 000 000 som
export const MAX_SALE_QUANTITY = 100_000_000;
export const FULL_PERCENT_BPS = 10_000; // 100.00 %

const isTwoDecimalNumber = (value: number): boolean =>
  Math.abs(Math.round(value * 100) - value * 100) < 1e-6;

/** Converts a non-negative som amount with at most 2 decimals into safe integer tyiyns. */
export const amountToMinor = (som: number): number | null => {
  if (!Number.isFinite(som) || som < 0 || !isTwoDecimalNumber(som)) return null;
  const minor = Math.round(som * 100);
  return Number.isSafeInteger(minor) ? minor : null;
};

/** Converts signed safe integer tyiyns into som (profit may be negative). */
export const signedMinorToAmount = (minor: number): number => minor / 100;

/** 10 % → 1000 bps, 100 % → 10000 bps; at most 2 decimals, range 0..100. */
export const percentToBasisPoints = (percent: number): number | null => {
  if (!Number.isFinite(percent) || percent < 0 || percent > 100 || !isTwoDecimalNumber(percent)) {
    return null;
  }
  return Math.round(percent * 100);
};

/** 1000 bps → 10 %. */
export const basisPointsToPercent = (bps: number): number => bps / 100;

export interface ServerDiscount {
  type: ServerDiscountType;
  value: number;
}

/**
 * Form discount → server discount: zero → ('none', 0), percent → bps, fixed → tyiyns.
 * Returns null for values the server would reject at the type level.
 */
export const toServerDiscount = (type: DiscountType, value: number): ServerDiscount | null => {
  if (!Number.isFinite(value) || value < 0) return null;
  if (value === 0) return { type: 'none', value: 0 };
  if (type === 'percent') {
    const bps = percentToBasisPoints(value);
    return bps === null ? null : { type: 'percent', value: bps };
  }
  const minor = amountToMinor(value);
  return minor === null ? null : { type: 'fixed', value: minor };
};

/** Server discount → form representation (the form has no 'none'; it is a zero fixed discount). */
export const fromServerDiscount = (
  type: ServerDiscountType,
  value: number
): { discountType: DiscountType; discountValue: number } => {
  if (type === 'percent') return { discountType: 'percent', discountValue: basisPointsToPercent(value) };
  if (type === 'fixed') return { discountType: 'fixed', discountValue: value / 100 };
  return { discountType: 'fixed', discountValue: 0 };
};

/** trunc((base × bps + 5000) / 10000) in BigInt — identical to the SQL numeric expression for base, bps ≥ 0. */
export const calculatePercentDiscountMinor = (baseMinor: number, bps: number): number =>
  Number((BigInt(baseMinor) * BigInt(bps) + 5000n) / 10000n);

export interface SaleLineMinorInput {
  quantity: number;
  unitPriceMinor: number;
  discount: ServerDiscount;
}

export interface SaleLineMinorTotals {
  grossMinor: number;
  itemDiscountMinor: number;
  /** gross − item discount (before the receipt discount) */
  finalBeforeReceiptMinor: number;
  receiptDiscountAllocatedMinor: number;
  netTotalMinor: number;
}

export interface SaleMinorTotals {
  lines: SaleLineMinorTotals[];
  subtotalMinor: number;
  itemDiscountTotalMinor: number;
  eligibleSubtotalMinor: number;
  receiptDiscountMinor: number;
  totalMinor: number;
  receivedMinor: number | null;
  changeMinor: number | null;
}

export type SaleMinorIssue =
  | 'quantity'
  | 'unit_price'
  | 'line_bounds'
  | 'item_discount_bounds'
  | 'item_discount_exceeds_line'
  | 'document_bounds'
  | 'receipt_discount_bounds'
  | 'receipt_discount_full_percent'
  | 'receipt_discount_exceeds_total'
  | 'total_not_positive'
  | 'received_missing'
  | 'received_less_than_total'
  | 'received_bounds';

export type SaleMinorResult =
  | { ok: true; totals: SaleMinorTotals }
  | { ok: false; issue: SaleMinorIssue; lineIndex?: number };

/**
 * Recomputes all receipt amounts exactly like rpc_create_sale (steps 6–9), including the
 * floor-based receipt discount allocation with 1-tyiyn remainder distribution in line order.
 */
export const calculateSaleMinorTotals = (
  lines: readonly SaleLineMinorInput[],
  receiptDiscount: ServerDiscount,
  paymentMethod: PaymentMethod,
  receivedMinor: number | null
): SaleMinorResult => {
  let subtotal = 0;
  let itemDiscountTotal = 0;
  let eligible = 0;
  const partial: Array<Pick<SaleLineMinorTotals, 'grossMinor' | 'itemDiscountMinor' | 'finalBeforeReceiptMinor'>> = [];

  for (let i = 0; i < lines.length; i++) {
    const { quantity, unitPriceMinor, discount } = lines[i];

    if (!Number.isSafeInteger(quantity) || quantity <= 0 || quantity > MAX_SALE_QUANTITY) {
      return { ok: false, issue: 'quantity', lineIndex: i };
    }
    if (!Number.isSafeInteger(unitPriceMinor) || unitPriceMinor < 0 || unitPriceMinor > MAX_UNIT_PRICE_MINOR) {
      return { ok: false, issue: 'unit_price', lineIndex: i };
    }

    const gross = quantity * unitPriceMinor;
    if (!Number.isSafeInteger(gross)) {
      return { ok: false, issue: 'line_bounds', lineIndex: i };
    }

    if (!Number.isSafeInteger(discount.value) || discount.value < 0) {
      return { ok: false, issue: 'item_discount_bounds', lineIndex: i };
    }

    let itemDiscount = 0;
    if (discount.type === 'percent') {
      if (discount.value > FULL_PERCENT_BPS) {
        return { ok: false, issue: 'item_discount_bounds', lineIndex: i };
      }
      itemDiscount = calculatePercentDiscountMinor(gross, discount.value);
    } else if (discount.type === 'fixed') {
      if (discount.value > gross) {
        return { ok: false, issue: 'item_discount_exceeds_line', lineIndex: i };
      }
      itemDiscount = discount.value;
    } else if (discount.value !== 0) {
      // CHECK sale_items_discount_none_zero
      return { ok: false, issue: 'item_discount_bounds', lineIndex: i };
    }

    const finalBeforeReceipt = gross - itemDiscount;
    subtotal += gross;
    itemDiscountTotal += itemDiscount;
    eligible += finalBeforeReceipt;
    if (!Number.isSafeInteger(subtotal) || !Number.isSafeInteger(eligible)) {
      return { ok: false, issue: 'document_bounds' };
    }

    partial.push({ grossMinor: gross, itemDiscountMinor: itemDiscount, finalBeforeReceiptMinor: finalBeforeReceipt });
  }

  if (!Number.isSafeInteger(receiptDiscount.value) || receiptDiscount.value < 0) {
    return { ok: false, issue: 'receipt_discount_bounds' };
  }

  let receiptDiscountMinor = 0;
  if (receiptDiscount.type === 'percent') {
    if (receiptDiscount.value > FULL_PERCENT_BPS) {
      return { ok: false, issue: 'receipt_discount_bounds' };
    }
    if (receiptDiscount.value > 0) {
      if (receiptDiscount.value >= FULL_PERCENT_BPS) {
        return { ok: false, issue: 'receipt_discount_full_percent' };
      }
      receiptDiscountMinor = calculatePercentDiscountMinor(eligible, receiptDiscount.value);
    }
  } else if (receiptDiscount.type === 'fixed') {
    if (receiptDiscount.value >= eligible) {
      return { ok: false, issue: 'receipt_discount_exceeds_total' };
    }
    receiptDiscountMinor = receiptDiscount.value;
  } else if (receiptDiscount.value !== 0) {
    // CHECK sales_receipt_discount_none_zero
    return { ok: false, issue: 'receipt_discount_bounds' };
  }

  const total = eligible - receiptDiscountMinor;
  if (total <= 0) {
    return { ok: false, issue: 'total_not_positive' };
  }

  let change: number | null = null;
  let received: number | null = null;
  if (paymentMethod === 'cash') {
    if (receivedMinor === null) return { ok: false, issue: 'received_missing' };
    if (!Number.isSafeInteger(receivedMinor) || receivedMinor < 0) {
      return { ok: false, issue: 'received_bounds' };
    }
    if (receivedMinor < total) return { ok: false, issue: 'received_less_than_total' };
    received = receivedMinor;
    change = receivedMinor - total;
  }

  // Step 9: floor allocation of the receipt discount, then 1-tyiyn remainder to lines with headroom
  const allocations = partial.map((line) => {
    if (receiptDiscountMinor <= 0 || eligible <= 0) return 0;
    const floor = Number(
      (BigInt(line.finalBeforeReceiptMinor) * BigInt(receiptDiscountMinor)) / BigInt(eligible)
    );
    return Math.min(floor, line.finalBeforeReceiptMinor);
  });
  const headrooms = partial.map((line, i) => line.finalBeforeReceiptMinor - allocations[i]);
  let remainder = receiptDiscountMinor - allocations.reduce((acc, a) => acc + a, 0);
  for (let i = 0; i < partial.length && remainder > 0; i++) {
    if (headrooms[i] > 0) {
      allocations[i] += 1;
      headrooms[i] -= 1;
      remainder -= 1;
    }
  }

  return {
    ok: true,
    totals: {
      lines: partial.map((line, i) => ({
        ...line,
        receiptDiscountAllocatedMinor: allocations[i],
        netTotalMinor: line.finalBeforeReceiptMinor - allocations[i],
      })),
      subtotalMinor: subtotal,
      itemDiscountTotalMinor: itemDiscountTotal,
      eligibleSubtotalMinor: eligible,
      receiptDiscountMinor,
      totalMinor: total,
      receivedMinor: received,
      changeMinor: change,
    },
  };
};
