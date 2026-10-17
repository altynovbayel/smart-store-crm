import { useState, useCallback } from 'react';
import type { OutcomeDocument, PendingOutcomeOperation } from '../../../types';
import {
  getPendingOutcomeOperation,
  setPendingOutcomeOperation,
  clearPendingOutcomeOperation,
} from '../../../utils/pendingOutcomeStorage';

/**
 * sessionStorage-backed state of the single unconfirmed outcome operation of the current user.
 * - Restored (and strictly validated, incl. UUID) on mount and on user switch.
 * - Clearing always checks the expected operation id, so a newer operation is never removed by mistake.
 */
export const usePendingOutcome = (userId: string | null) => {
  const [pendingOperation, setPendingOperation] = useState<PendingOutcomeOperation | null>(() =>
    getPendingOutcomeOperation(userId)
  );

  const [prevUserId, setPrevUserId] = useState<string | null>(userId);
  if (prevUserId !== userId) {
    setPrevUserId(userId);
    setPendingOperation(getPendingOutcomeOperation(userId));
  }

  /** Persists the operation BEFORE the RPC call. Returns false when storage is unavailable. */
  const persistPending = useCallback((op: PendingOutcomeOperation): boolean => {
    if (!setPendingOutcomeOperation(op)) return false;
    setPendingOperation(op);
    return true;
  }, []);

  /** Clears the stored operation only if it still has the expected id. */
  const clearPending = useCallback((ownerUserId: string, expectedId: string) => {
    clearPendingOutcomeOperation(ownerUserId, expectedId);
    setPendingOperation((prev) => (prev?.id === expectedId ? null : prev));
  }, []);

  /**
   * If the stored operation is present among loaded server documents, it was committed:
   * clear it and return it for notification; otherwise return null.
   */
  const confirmPendingFromDocuments = useCallback(
    (documents: OutcomeDocument[]): PendingOutcomeOperation | null => {
      if (!userId) return null;
      const stored = getPendingOutcomeOperation(userId);
      if (!stored || !documents.some((d) => d.id === stored.id)) return null;
      clearPending(userId, stored.id);
      return stored;
    },
    [userId, clearPending]
  );

  return {
    pendingOperation,
    persistPending,
    clearPending,
    confirmPendingFromDocuments,
  };
};
