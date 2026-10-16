import type { IncomeReceiptFormData, PendingIncomeOperation } from '../types';

export type { PendingIncomeOperation };

const inMemoryFallback = new Map<string, string>();

const getStorageKey = (userId: string): string =>
  `smart_store_pending_income_operation_${userId}`;

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

/**
 * Deterministically normalizes form business fields to allow accurate payload equality comparison.
 * Excludes transient runtime keys such as `id` and server-determined fields like `responsiblePerson`.
 */
export const normalizeIncomePayload = (payload: IncomeReceiptFormData): string => {
  return JSON.stringify({
    supplier: payload.supplier.trim(),
    documentNumber: payload.documentNumber?.trim() || '',
    receivedAt: payload.receivedAt.trim(),
    comment: payload.comment?.trim() || '',
    items: (payload.items || []).map((it) => ({
      productId: it.productId.trim(),
      quantity: it.quantity,
      purchasePrice: it.purchasePrice,
    })),
  });
};

/**
 * Deeply validates the integrity and structure of a restored pending income operation record.
 */
export const isValidPendingIncomeOperation = (
  obj: unknown,
  expectedUserId: string
): obj is PendingIncomeOperation => {
  if (!obj || typeof obj !== 'object') return false;
  const candidate = obj as Record<string, unknown>;

  if (candidate.userId !== expectedUserId) return false;
  if (typeof candidate.id !== 'string' || !candidate.id.trim()) return false;
  if (typeof candidate.submittedAt !== 'string' || !candidate.submittedAt.trim()) return false;
  if (!candidate.payload || typeof candidate.payload !== 'object') return false;

  const payload = candidate.payload as Record<string, unknown>;
  if (typeof payload.supplier !== 'string' || !payload.supplier.trim()) return false;
  if (typeof payload.receivedAt !== 'string' || !payload.receivedAt.trim()) return false;
  if (typeof payload.responsiblePerson !== 'string' || !payload.responsiblePerson.trim()) return false;
  if (payload.documentNumber !== undefined && typeof payload.documentNumber !== 'string') return false;
  if (payload.comment !== undefined && typeof payload.comment !== 'string') return false;

  if (!Array.isArray(payload.items) || payload.items.length === 0) return false;

  for (const item of payload.items) {
    if (!item || typeof item !== 'object') return false;
    const it = item as Record<string, unknown>;
    if (typeof it.productId !== 'string' || !it.productId.trim()) return false;
    if (typeof it.quantity !== 'number' || !Number.isSafeInteger(it.quantity) || it.quantity <= 0) return false;
    if (typeof it.purchasePrice !== 'number' || !Number.isFinite(it.purchasePrice) || it.purchasePrice < 0) return false;
  }

  return true;
};

/**
 * Reads pending unconfirmed income receipt operation from sessionStorage for the given user.
 */
export const getPendingIncomeOperation = (
  userId: string | null
): PendingIncomeOperation | null => {
  if (!userId) return null;
  try {
    const raw = safeGetStorageItem(getStorageKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (isValidPendingIncomeOperation(parsed, userId)) {
      return parsed;
    }
    // Corrupted record: safely purge to prevent crashes
    safeRemoveStorageItem(getStorageKey(userId));
  } catch {
    // Ignore parse exceptions and clean up
    safeRemoveStorageItem(getStorageKey(userId));
  }
  return null;
};

/**
 * Stores pending unconfirmed income receipt operation to survive form closure or page reload.
 * Returns true if the operation was successfully persisted to storage or memory fallback.
 */
export const setPendingIncomeOperation = (op: PendingIncomeOperation): boolean => {
  if (!op.userId) return false;
  try {
    const serialized = JSON.stringify(op);
    return safeSetStorageItem(getStorageKey(op.userId), serialized);
  } catch {
    return false;
  }
};

/**
 * Clears pending income receipt operation after confirmed server response or verified status.
 * If expectedId is provided, only removes if the currently stored operation matches this ID,
 * preventing accidental removal of another concurrent or subsequent operation.
 */
export const clearPendingIncomeOperation = (
  userId: string | null,
  expectedId?: string
): boolean => {
  if (!userId) return false;
  if (expectedId) {
    const current = getPendingIncomeOperation(userId);
    if (!current || current.id !== expectedId) {
      return false;
    }
  }
  safeRemoveStorageItem(getStorageKey(userId));
  return true;
};
