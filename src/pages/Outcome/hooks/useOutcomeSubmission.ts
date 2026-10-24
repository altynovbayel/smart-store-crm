import { useState, useEffect, useCallback, useRef } from 'react';
import type {
  OutcomeSubmitPayload,
  OutcomeSubmitResult,
  PendingOutcomeOperation,
} from '../../../types';
import { OUTCOME_REASONS } from '../../../types';
import { outcomeApi, isIndeterminateOutcomeError } from '../../../api/outcome';
import { getPendingOutcomeOperation } from '../../../utils/pendingOutcomeStorage';
import { isValidUuid } from '../../../utils/uuidUtils';
import { restoreFocusWithFallback } from '../../../utils/focusUtils';

interface UseOutcomeSubmissionOptions {
  userId: string | null;
  pendingOperation: PendingOutcomeOperation | null;
  persistPending: (op: PendingOutcomeOperation) => boolean;
  clearPending: (ownerUserId: string, expectedId: string) => void;
  reloadAll: () => Promise<void>;
  /** Refreshes catalog stocks only; the open form keeps its entered data. */
  refreshProducts: () => Promise<void>;
  notify: (message: string) => void;
  isAnyModalOpen: () => boolean;
}

/**
 * Conducts outcome write-offs through `rpc_create_outcome_document` with a mandatory idempotency UUID.
 * - The UUID is validated and the operation persisted BEFORE the RPC call.
 * - Network / auth / internal errors keep the pending operation (server outcome unknown).
 * - Validation / domain errors clear it (with expected-id check): nothing was committed.
 *   A domain refusal also refreshes catalog stocks, which may have been changed by another user.
 * - Resolving a pending operation first looks it up by id, then retries with the SAME UUID.
 */
export const useOutcomeSubmission = ({
  userId,
  pendingOperation,
  persistPending,
  clearPending,
  reloadAll,
  refreshProducts,
  notify,
  isAnyModalOpen,
}: UseOutcomeSubmissionOptions) => {
  const [isResolvingPending, setIsResolvingPending] = useState<boolean>(false);

  const [prevUserId, setPrevUserId] = useState<string | null>(userId);
  if (prevUserId !== userId) {
    setPrevUserId(userId);
    setIsResolvingPending(false);
  }

  const userIdRef = useRef(userId);
  useEffect(() => {
    userIdRef.current = userId;
  }, [userId]);

  const isMountedRef = useRef<boolean>(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const handleResolvePending = useCallback(async () => {
    if (!pendingOperation || !userId || isResolvingPending) return;
    const targetOp = pendingOperation;
    const targetOpId = targetOp.id;
    const activeUserId = userId;
    const wasFocusOnResolveBtn = Boolean(
      document.activeElement?.closest('[data-resolve-pending-btn]')
    );

    setIsResolvingPending(true);
    let shouldRestoreFocus = false;

    try {
      const checkRes = await outcomeApi.fetchOutcomeDocumentById(targetOpId);
      if (!isMountedRef.current || userIdRef.current !== activeUserId) return;

      if (!checkRes.success) {
        notify('Связь с сервером ещё не восстановлена. Проверьте интернет-соединение.');
        return;
      }

      if (checkRes.data) {
        clearPending(activeUserId, targetOpId);
        await reloadAll();
        notify(`Акт списания № ${checkRes.data.outcomeNumber} успешно проведён на сервере.`);
        shouldRestoreFocus = true;
        return;
      }

      // Row not found: safely retry using the SAME idempotency UUID
      const retryRes = await outcomeApi.createOutcomeDocument({
        ...targetOp.payload,
        id: targetOpId,
      });

      if (!isMountedRef.current || userIdRef.current !== activeUserId) return;

      if (retryRes.success) {
        clearPending(activeUserId, targetOpId);
        await reloadAll();
        const reasonLabel =
          OUTCOME_REASONS[targetOp.payload.reason] || targetOp.payload.reason;
        notify(`Документ списания («${reasonLabel}») успешно проведён на сервере.`);
        shouldRestoreFocus = true;
      } else if (!isIndeterminateOutcomeError(retryRes.error)) {
        // Deterministic refusal: transaction aborted, safe to clear
        clearPending(activeUserId, targetOpId);
        if (retryRes.error.kind === 'domain') {
          void refreshProducts();
        }
        notify(
          `Сервер отклонил списание: ${retryRes.error.message} Теперь можно оформить списание заново.`
        );
        shouldRestoreFocus = true;
      } else if (retryRes.error.kind === 'auth') {
        notify(
          `${retryRes.error.message} Неподтверждённое списание сохранено для повторной проверки.`
        );
      } else if (retryRes.error.kind === 'network') {
        notify('Связь с сервером ещё не восстановлена. Проверьте подключение к сети.');
      } else {
        notify(retryRes.error.message);
      }
    } finally {
      if (isMountedRef.current && userIdRef.current === activeUserId) {
        setIsResolvingPending(false);
      }
      requestAnimationFrame(() => {
        if (!isMountedRef.current || isAnyModalOpen()) return;

        if (shouldRestoreFocus) {
          restoreFocusWithFallback(null, '[data-add-outcome-btn]');
        } else if (
          wasFocusOnResolveBtn ||
          document.activeElement === document.body ||
          !document.activeElement
        ) {
          const resolveBtn = document.querySelector<HTMLElement>(
            '[data-resolve-pending-btn]:not(:disabled)'
          );
          resolveBtn?.focus();
        }
      });
    }
  }, [
    pendingOperation,
    userId,
    isResolvingPending,
    clearPending,
    reloadAll,
    refreshProducts,
    notify,
    isAnyModalOpen,
  ]);

  const handleCreateOutcome = useCallback(
    async (data: OutcomeSubmitPayload): Promise<OutcomeSubmitResult> => {
      const { id: opId, ...purePayload } = data;
      const activeUserId = userId;

      // Never reach the RPC without a valid, pre-generated idempotency key
      if (!isValidUuid(opId)) {
        return {
          success: false,
          error: {
            kind: 'validation',
            message:
              'Внутренняя ошибка: отсутствует корректный идентификатор операции списания. Списание не отправлено — повторите попытку.',
          },
        };
      }

      if (!activeUserId) {
        return {
          success: false,
          error: {
            kind: 'validation',
            message: 'Сессия не найдена. Выполните вход заново. Списание не отправлено.',
          },
        };
      }

      // Never overwrite another unconfirmed operation: it would lose its UUID and allow a double write-off
      const storedPending = getPendingOutcomeOperation(activeUserId);
      if (storedPending && storedPending.id !== opId) {
        return {
          success: false,
          error: {
            kind: 'validation',
            message:
              'Имеется другое неподтверждённое списание. Закройте форму и нажмите «Проверить статус», прежде чем оформлять новое.',
          },
        };
      }

      // Persist pending operation in storage BEFORE calling RPC
      const persisted = persistPending({
        id: opId,
        userId: activeUserId,
        payload: purePayload,
        submittedAt: storedPending?.submittedAt ?? new Date().toISOString(),
      });
      if (!persisted) {
        return {
          success: false,
          error: {
            kind: 'validation',
            message:
              'Не удалось зафиксировать сессию операции перед проведением. Проверьте настройки хранилища браузера.',
          },
        };
      }

      const res = await outcomeApi.createOutcomeDocument({
        ...purePayload,
        id: opId,
      });

      if (res.success) {
        clearPending(activeUserId, opId);
        if (!isMountedRef.current || userIdRef.current !== activeUserId) {
          return { success: true };
        }
        const reasonLabel = OUTCOME_REASONS[purePayload.reason] || purePayload.reason;
        notify(
          `Списание товаров («${reasonLabel}») успешно проведено. Остатки товаров на складе списаны.`
        );
        // Refetch fresh documents and updated product catalog stocks from Supabase
        await reloadAll();
        return { success: true };
      }

      if (!isIndeterminateOutcomeError(res.error)) {
        // Confirmed refusal (nothing committed): safe to clear pending operation
        clearPending(activeUserId, opId);
        // Server-side stock / archive state may differ from the loaded catalog
        if (
          res.error.kind === 'domain' &&
          isMountedRef.current &&
          userIdRef.current === activeUserId
        ) {
          void refreshProducts();
        }
      }
      // Network / auth / internal error: pending operation stays in storage and state

      return { success: false, error: res.error };
    },
    [userId, persistPending, clearPending, reloadAll, refreshProducts, notify]
  );

  return {
    isResolvingPending,
    handleResolvePending,
    handleCreateOutcome,
  };
};
