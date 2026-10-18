import { useState, useEffect, useCallback, useRef } from 'react';
import type {
  PendingSaleOperation,
  Product,
  SaleSubmitPayload,
  SaleSubmitResult,
} from '../../../types';
import { salesApi, isIndeterminateSaleError } from '../../../api/sales';
import { getPendingSaleOperation } from '../../../utils/pendingSaleStorage';
import {
  describeSaleCatalogChanges,
  detectSaleCatalogChanges,
} from '../../../utils/saleCatalogCheck';
import { isValidUuid } from '../../../utils/uuidUtils';
import { formatCurrency } from '../../../utils/formatUtils';
import { restoreFocusWithFallback } from '../../../utils/focusUtils';

interface UseSaleSubmissionOptions {
  userId: string | null;
  pendingOperation: PendingSaleOperation | null;
  persistPending: (op: PendingSaleOperation) => boolean;
  clearPending: (ownerUserId: string, expectedId: string) => void;
  reloadAll: () => Promise<void>;
  /** Reloads the active catalog; resolves with the fresh products or null on failure. */
  refreshProducts: () => Promise<Product[] | null>;
  notify: (message: string) => void;
  isAnyModalOpen: () => boolean;
}

/**
 * Conducts sales through `rpc_create_sale` with a mandatory idempotency UUID.
 * - New sale: the active catalog is reloaded first; any change of price, stock or availability
 *   stops the submission (nothing is sent) so the user can review the new total.
 * - The UUID is validated and the operation persisted BEFORE the RPC call.
 * - Network / auth / internal errors keep the pending operation (server outcome unknown).
 * - Validation / domain errors clear it (with expected-id check); domain errors refresh the catalog.
 * - Resolving a pending sale first looks it up by id, then retries with the SAME UUID.
 * Stock is never decremented optimistically: the UI only reflects reloaded server data.
 */
export const useSaleSubmission = ({
  userId,
  pendingOperation,
  persistPending,
  clearPending,
  reloadAll,
  refreshProducts,
  notify,
  isAnyModalOpen,
}: UseSaleSubmissionOptions) => {
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

  const isStale = (activeUserId: string) =>
    !isMountedRef.current || userIdRef.current !== activeUserId;

  const handleResolvePending = useCallback(async () => {
    if (!pendingOperation || !userId || isResolvingPending) return;
    const targetOp = pendingOperation;
    const targetOpId = targetOp.id;
    const activeUserId = userId;
    const wasFocusOnResolveBtn = Boolean(
      document.activeElement?.closest('[data-resolve-pending-sale-btn]')
    );

    setIsResolvingPending(true);
    let shouldRestoreFocus = false;

    try {
      const checkRes = await salesApi.fetchSaleById(targetOpId);
      if (!isMountedRef.current || userIdRef.current !== activeUserId) return;

      if (!checkRes.success) {
        notify('Связь с сервером ещё не восстановлена. Проверьте интернет-соединение.');
        return;
      }

      if (checkRes.data) {
        clearPending(activeUserId, targetOpId);
        await reloadAll();
        notify(`Чек № ${checkRes.data.receiptNumber} успешно проведён на сервере.`);
        shouldRestoreFocus = true;
        return;
      }

      // Receipt not found: safely retry using the SAME idempotency UUID and the stored payload
      const retryRes = await salesApi.createSale({ ...targetOp.payload, id: targetOpId });

      if (!isMountedRef.current || userIdRef.current !== activeUserId) return;

      if (retryRes.success) {
        clearPending(activeUserId, targetOpId);
        await reloadAll();
        notify(`Чек № ${retryRes.data.receiptNumber} успешно проведён на сервере.`);
        shouldRestoreFocus = true;
      } else if (!isIndeterminateSaleError(retryRes.error)) {
        // Deterministic refusal: transaction aborted, safe to clear
        clearPending(activeUserId, targetOpId);
        if (retryRes.error.kind === 'domain') {
          void refreshProducts();
        }
        notify(`Сервер отклонил продажу: ${retryRes.error.message} Теперь можно оформить продажу заново.`);
        shouldRestoreFocus = true;
      } else if (retryRes.error.kind === 'auth') {
        notify(`${retryRes.error.message} Неподтверждённая продажа сохранена для повторной проверки.`);
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
          restoreFocusWithFallback(null, '[data-add-sale-btn]');
        } else if (
          wasFocusOnResolveBtn ||
          document.activeElement === document.body ||
          !document.activeElement
        ) {
          document
            .querySelector<HTMLElement>('[data-resolve-pending-sale-btn]:not(:disabled)')
            ?.focus();
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

  const handleCreateSale = useCallback(
    async (data: SaleSubmitPayload): Promise<SaleSubmitResult> => {
      const { id: opId, ...purePayload } = data;
      const activeUserId = userId;

      // Never reach the RPC without a valid, pre-generated idempotency key
      if (!isValidUuid(opId)) {
        return {
          success: false,
          error: {
            kind: 'validation',
            message:
              'Внутренняя ошибка: отсутствует корректный идентификатор продажи. Продажа не отправлена — повторите попытку.',
          },
        };
      }

      if (!activeUserId) {
        return {
          success: false,
          error: { kind: 'validation', message: 'Сессия не найдена. Выполните вход заново. Продажа не отправлена.' },
        };
      }

      // Never overwrite another unconfirmed sale: it would lose its UUID and allow a double write-off
      const storedPending = getPendingSaleOperation(activeUserId);
      if (storedPending && storedPending.id !== opId) {
        return {
          success: false,
          error: {
            kind: 'validation',
            message:
              'Имеется другая неподтверждённая продажа. Закройте форму и нажмите «Проверить статус», прежде чем оформлять новую.',
          },
        };
      }

      const isRetry = storedPending?.id === opId;

      // New sale: confirm price, stock and availability against the fresh catalog (retry keeps its payload)
      if (!isRetry) {
        const freshCatalog = await refreshProducts();
        if (isStale(activeUserId)) {
          return { success: false, error: { kind: 'validation', message: 'Продажа не отправлена.' } };
        }
        if (!freshCatalog) {
          return {
            success: false,
            error: {
              kind: 'validation',
              message:
                'Не удалось проверить актуальность цен и остатков. Продажа не отправлена — проверьте подключение и повторите попытку.',
            },
          };
        }
        const changes = detectSaleCatalogChanges(purePayload.items, freshCatalog);
        if (changes.length > 0) {
          return {
            success: false,
            error: { kind: 'validation', message: describeSaleCatalogChanges(changes), field: 'itemsGeneral' },
            catalogRefreshed: true,
          };
        }
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

      const res = await salesApi.createSale({ ...purePayload, id: opId });

      if (res.success) {
        clearPending(activeUserId, opId);
        if (isStale(activeUserId)) {
          return { success: true };
        }
        const changeText =
          res.data.changeAmount !== null && res.data.changeAmount > 0
            ? ` Сдача: ${formatCurrency(res.data.changeAmount)}.`
            : '';
        notify(
          `Чек № ${res.data.receiptNumber} на сумму ${formatCurrency(res.data.totalAmount)} проведён. Остатки списаны со склада.${changeText}`
        );
        // Refetch receipts and catalog stocks from Supabase (no optimistic stock updates)
        await reloadAll();
        return { success: true };
      }

      let catalogRefreshed = false;
      if (!isIndeterminateSaleError(res.error)) {
        // Confirmed refusal (nothing committed): safe to clear pending operation
        clearPending(activeUserId, opId);
        // Price / stock / archive state on the server differs from the loaded catalog
        if (res.error.kind === 'domain' && !isStale(activeUserId)) {
          catalogRefreshed = (await refreshProducts()) !== null;
        }
      }
      // Network / auth / internal error: pending operation stays in storage and state

      return { success: false, error: res.error, catalogRefreshed };
    },
    [userId, persistPending, clearPending, reloadAll, refreshProducts, notify]
  );

  return {
    isResolvingPending,
    handleResolvePending,
    handleCreateSale,
  };
};
