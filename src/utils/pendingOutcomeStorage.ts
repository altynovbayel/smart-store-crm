import type { OutcomeFormData, PendingOutcomeOperation, OutcomeReason } from '../types';
import { isValidUuid } from './uuidUtils';

export type { PendingOutcomeOperation };

const inMemoryFallback = new Map<string, string>();

const VALID_REASONS: Set<OutcomeReason> = new Set([
  'damaged',
  'defective',
  'lost',
  'internal_use',
  'other',
]);

const getStorageKey = (userId: string): string =>
  `smart_store_pending_outcome_operation_${userId}`;

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
export const normalizeOutcomePayload = (payload: OutcomeFormData): string => {
  const sortedItems = [...(payload.items || [])]
    .map((it) => ({
      productId: it.productId.trim(),
      quantity: it.quantity,
    }))
    .sort((a, b) => a.productId.localeCompare(b.productId));

  return JSON.stringify({
    reason: payload.reason,
    documentDate: payload.documentDate.trim(),
    comment: payload.comment?.trim() || '',
    items: sortedItems,
  });
};

/**
 * Deeply validates the integrity and structure of a restored pending outcome operation record.
 */
export const isValidPendingOutcomeOperation = (
  obj: unknown,
  expectedUserId: string
): obj is PendingOutcomeOperation => {
  if (!obj || typeof obj !== 'object') return false;
  const candidate = obj as Record<string, unknown>;

  if (candidate.userId !== expectedUserId) return false;
  // The idempotency key is sent to the RPC as `p_id uuid`, so it must be a strict UUID
  if (!isValidUuid(candidate.id)) return false;
  if (typeof candidate.submittedAt !== 'string' || !candidate.submittedAt.trim()) return false;
  if (!candidate.payload || typeof candidate.payload !== 'object') return false;

  const payload = candidate.payload as Record<string, unknown>;
  if (!VALID_REASONS.has(payload.reason as OutcomeReason)) return false;
  if (typeof payload.documentDate !== 'string' || !payload.documentDate.trim()) return false;
  if (payload.comment !== undefined && typeof payload.comment !== 'string') return false;
  if (payload.responsiblePerson !== undefined && typeof payload.responsiblePerson !== 'string') {
    return false;
  }

  if (!Array.isArray(payload.items) || payload.items.length === 0) return false;

  for (const item of payload.items) {
    if (!item || typeof item !== 'object') return false;
    const it = item as Record<string, unknown>;
    if (typeof it.productId !== 'string' || !it.productId.trim()) return false;
    if (typeof it.quantity !== 'number' || !Number.isSafeInteger(it.quantity) || it.quantity <= 0) {
      return false;
    }
  }

  return true;
};

/**
 * Reads pending unconfirmed outcome write-off operation from sessionStorage for the given user.
 */
export const getPendingOutcomeOperation = (
  userId: string | null
): PendingOutcomeOperation | null => {
  if (!userId) return null;
  try {
    const raw = safeGetStorageItem(getStorageKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (isValidPendingOutcomeOperation(parsed, userId)) {
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
 * Stores pending unconfirmed outcome operation to survive form closure or page reload.
 * Returns true if the operation was successfully persisted to storage.
 */
export const setPendingOutcomeOperation = (op: PendingOutcomeOperation): boolean => {
  if (!op.userId) return false;
  try {
    const serialized = JSON.stringify(op);
    return safeSetStorageItem(getStorageKey(op.userId), serialized);
  } catch {
    return false;
  }
};

/**
 * Clears pending outcome operation after confirmed server response or verified status.
 * If expectedId is provided, only removes if the currently stored operation matches this ID,
 * preventing accidental removal of another concurrent or subsequent operation.
 */
export const clearPendingOutcomeOperation = (
  userId: string | null,
  expectedId?: string
): boolean => {
  if (!userId) return false;
  if (expectedId) {
    const current = getPendingOutcomeOperation(userId);
    if (!current || current.id !== expectedId) {
      return false;
    }
  }
  safeRemoveStorageItem(getStorageKey(userId));
  return true;
};
