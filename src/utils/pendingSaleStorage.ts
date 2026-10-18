import type { DiscountType, PaymentMethod, PendingSaleOperation, SaleFormData } from '../types';
import { isValidUuid } from './uuidUtils';

export type { PendingSaleOperation };

const inMemoryFallback = new Map<string, string>();

const VALID_PAYMENT_METHODS: ReadonlySet<string> = new Set<PaymentMethod>(['cash', 'card', 'transfer']);
const VALID_DISCOUNT_TYPES: ReadonlySet<string> = new Set<DiscountType>(['fixed', 'percent']);

const getStorageKey = (userId: string): string => `smart_store_pending_sale_operation_${userId}`;

const safeGetStorageItem = (key: string): string | null => {
  if (typeof window !== 'undefined') {
    try {
      if ('sessionStorage' in window && window.sessionStorage) {
        return window.sessionStorage.getItem(key);
      }
    } catch {
      return null;
    }
    return null;
  }
  return inMemoryFallback.get(key) ?? null;
};

const safeSetStorageItem = (key: string, value: string): boolean => {
  if (typeof window !== 'undefined') {
    try {
      if ('sessionStorage' in window && window.sessionStorage) {
        window.sessionStorage.setItem(key, value);
        inMemoryFallback.delete(key);
        return true;
      }
    } catch {
      // Storage failed (quota, security restrictions, or disabled storage) — in browser never leak into memory fallback
      return false;
    }
    return false;
  }
  // In non-browser environments (e.g. Node tests without window):
  inMemoryFallback.set(key, value);
  return true;
};

const safeRemoveStorageItem = (key: string): void => {
  if (typeof window !== 'undefined') {
    try {
      if ('sessionStorage' in window && window.sessionStorage) {
        window.sessionStorage.removeItem(key);
      }
    } catch {
      // Ignore storage access errors
    }
  }
  inMemoryFallback.delete(key);
};

const isNonNegativeFinite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

/**
 * Deterministically normalizes sale business fields for payload equality comparison.
 * Excludes the idempotency `id` and the server-determined `responsiblePerson`.
 * Line order is irrelevant to the server result, so lines are sorted by product id.
 */
export const normalizeSalePayload = (payload: SaleFormData): string => {
  const sortedItems = [...payload.items]
    .map((it) => ({
      productId: it.productId.trim(),
      quantity: it.quantity,
      unitPrice: it.unitPrice,
      discountType: it.discountValue === 0 ? 'none' : it.discountType,
      discountValue: it.discountValue,
    }))
    .sort((a, b) => (a.productId < b.productId ? -1 : a.productId > b.productId ? 1 : 0));

  return JSON.stringify({
    soldAt: payload.soldAt.trim(),
    paymentMethod: payload.paymentMethod,
    receivedAmount: payload.paymentMethod === 'cash' ? payload.receivedAmount ?? null : null,
    comment: payload.comment?.trim() || '',
    receiptDiscountType: payload.receiptDiscountValue === 0 ? 'none' : payload.receiptDiscountType,
    receiptDiscountValue: payload.receiptDiscountValue,
    items: sortedItems,
  });
};

/**
 * Deeply validates the integrity and structure of a restored pending sale operation record.
 */
export const isValidPendingSaleOperation = (
  obj: unknown,
  expectedUserId: string
): obj is PendingSaleOperation => {
  if (!obj || typeof obj !== 'object') return false;
  const candidate = obj as Record<string, unknown>;

  if (candidate.userId !== expectedUserId) return false;
  // The idempotency key is sent to the RPC as `p_id uuid`, so it must be a strict UUID
  if (!isValidUuid(candidate.id)) return false;
  if (typeof candidate.submittedAt !== 'string' || !candidate.submittedAt.trim()) return false;
  if (!candidate.payload || typeof candidate.payload !== 'object') return false;

  const payload = candidate.payload as Record<string, unknown>;
  if (typeof payload.soldAt !== 'string' || !payload.soldAt.trim()) return false;
  if (typeof payload.paymentMethod !== 'string' || !VALID_PAYMENT_METHODS.has(payload.paymentMethod)) {
    return false;
  }
  if (payload.paymentMethod === 'cash' && !isNonNegativeFinite(payload.receivedAmount)) return false;
  if (payload.receivedAmount !== undefined && !isNonNegativeFinite(payload.receivedAmount)) return false;
  if (typeof payload.responsiblePerson !== 'string') return false;
  if (payload.comment !== undefined && typeof payload.comment !== 'string') return false;
  if (
    typeof payload.receiptDiscountType !== 'string' ||
    !VALID_DISCOUNT_TYPES.has(payload.receiptDiscountType)
  ) {
    return false;
  }
  if (!isNonNegativeFinite(payload.receiptDiscountValue)) return false;

  if (!Array.isArray(payload.items) || payload.items.length === 0) return false;

  for (const item of payload.items) {
    if (!item || typeof item !== 'object') return false;
    const it = item as Record<string, unknown>;
    if (!isValidUuid(it.productId)) return false;
    if (typeof it.quantity !== 'number' || !Number.isSafeInteger(it.quantity) || it.quantity <= 0) {
      return false;
    }
    if (!isNonNegativeFinite(it.unitPrice)) return false;
    if (typeof it.discountType !== 'string' || !VALID_DISCOUNT_TYPES.has(it.discountType)) return false;
    if (!isNonNegativeFinite(it.discountValue)) return false;
  }

  return true;
};

/**
 * Reads the pending unconfirmed sale of the given user from sessionStorage.
 */
export const getPendingSaleOperation = (userId: string | null): PendingSaleOperation | null => {
  if (!userId) return null;
  try {
    const raw = safeGetStorageItem(getStorageKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (isValidPendingSaleOperation(parsed, userId)) {
      return parsed;
    }
    // Corrupted record: safely purge to prevent crashes
    safeRemoveStorageItem(getStorageKey(userId));
  } catch {
    safeRemoveStorageItem(getStorageKey(userId));
  }
  return null;
};

/**
 * Stores the pending unconfirmed sale to survive form closure or page reload.
 * Returns true if the operation was successfully persisted to storage.
 */
export const setPendingSaleOperation = (op: PendingSaleOperation): boolean => {
  if (!op.userId) return false;
  try {
    return safeSetStorageItem(getStorageKey(op.userId), JSON.stringify(op));
  } catch {
    return false;
  }
};

/**
 * Clears the pending sale after a confirmed server response or verified status.
 * With expectedId, only removes the stored operation if it still has this id,
 * so a newer operation is never removed by mistake.
 */
export const clearPendingSaleOperation = (userId: string | null, expectedId?: string): boolean => {
  if (!userId) return false;
  if (expectedId) {
    const current = getPendingSaleOperation(userId);
    if (!current || current.id !== expectedId) {
      return false;
    }
  }
  safeRemoveStorageItem(getStorageKey(userId));
  return true;
};
