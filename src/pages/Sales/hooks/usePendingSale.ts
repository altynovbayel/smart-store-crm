import { useState, useCallback } from 'react';
import type { PendingSaleOperation, Sale } from '../../../types';
import {
  getPendingSaleOperation,
  setPendingSaleOperation,
  clearPendingSaleOperation,
} from '../../../utils/pendingSaleStorage';

/**
 * sessionStorage-backed state of the single unconfirmed sale of the current user.
 * - Restored (and strictly validated, incl. UUID) on mount and on user switch.
 * - Clearing always checks the expected operation id, so a newer operation is never removed by mistake.
 */
export const usePendingSale = (userId: string | null) => {
  const [pendingOperation, setPendingOperation] = useState<PendingSaleOperation | null>(() =>
    getPendingSaleOperation(userId)
  );

  const [prevUserId, setPrevUserId] = useState<string | null>(userId);
  if (prevUserId !== userId) {
    setPrevUserId(userId);
    setPendingOperation(getPendingSaleOperation(userId));
  }

  /** Persists the operation BEFORE the RPC call. Returns false when storage is unavailable. */
  const persistPending = useCallback((op: PendingSaleOperation): boolean => {
    if (!setPendingSaleOperation(op)) return false;
    setPendingOperation(op);
    return true;
  }, []);

  /** Clears the stored operation only if it still has the expected id. */
  const clearPending = useCallback((ownerUserId: string, expectedId: string) => {
    clearPendingSaleOperation(ownerUserId, expectedId);
    setPendingOperation((prev) => (prev?.id === expectedId ? null : prev));
  }, []);

  /**
   * If the stored sale is present among loaded server receipts, it was committed:
   * clear it and return it for notification; otherwise return null.
   */
  const confirmPendingFromSales = useCallback(
    (sales: Sale[]): PendingSaleOperation | null => {
      if (!userId) return null;
      const stored = getPendingSaleOperation(userId);
      if (!stored || !sales.some((s) => s.id === stored.id)) return null;
      clearPending(userId, stored.id);
      return stored;
    },
    [userId, clearPending]
  );

  return {
    pendingOperation,
    persistPending,
    clearPending,
    confirmPendingFromSales,
  };
};
