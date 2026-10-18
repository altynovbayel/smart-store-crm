import { useState, useRef } from 'react';
import type { PendingSaleOperation, SaleFormData } from '../../../types';
import { normalizeSalePayload } from '../../../utils/pendingSaleStorage';
import { generateUuid, isValidUuid } from '../../../utils/uuidUtils';

const PAYLOAD_MISMATCH_MESSAGE =
  'Предыдущая отправка завершилась ошибкой сети, и её результат на сервере ещё не определён. Чтобы избежать повторного списания, повторите отправку с исходными данными.';

const MISSING_RETRY_KEY_MESSAGE =
  'Внутренняя ошибка: потерян идентификатор неподтверждённой продажи. Закройте форму и нажмите «Проверить статус» на странице.';

const UUID_UNAVAILABLE_MESSAGE =
  'Не удалось создать идентификатор продажи: браузер не предоставляет криптографический генератор. Продажа не отправлена.';

export type SaleSubmissionKeyResult = { ok: true; key: string } | { ok: false; message: string };

/**
 * Idempotency key lifecycle of one sale form:
 * - restored from the pending sale, otherwise generated once (CSPRNG) on the first submit;
 * - never regenerated while the previous outcome is indeterminate;
 * - while indeterminate, only the exact same (normalized) payload may be re-sent;
 * - after a deterministic refusal the key is released, corrected data gets a fresh key.
 */
export const useSaleIdempotency = (pendingOperation: PendingSaleOperation | null | undefined) => {
  const keyRef = useRef<string | null>(pendingOperation ? pendingOperation.id : null);
  const lastPayloadRef = useRef<string | null>(
    pendingOperation ? normalizeSalePayload(pendingOperation.payload) : null
  );
  const isIndeterminateRef = useRef<boolean>(Boolean(pendingOperation));
  const [isIndeterminate, setIsIndeterminate] = useState<boolean>(() => Boolean(pendingOperation));

  const setIndeterminate = (value: boolean) => {
    isIndeterminateRef.current = value;
    setIsIndeterminate(value);
  };

  /** True when the submit is a retry of an unconfirmed sale with its original key. */
  const isRetrySubmission = (): boolean => Boolean(isIndeterminateRef.current && keyRef.current);

  /** Validates the payload lock and returns the key for this submission (never a new one on retry). */
  const prepareSubmission = (payload: SaleFormData): SaleSubmissionKeyResult => {
    const snapshot = normalizeSalePayload(payload);

    if (isIndeterminateRef.current && lastPayloadRef.current && lastPayloadRef.current !== snapshot) {
      return { ok: false, message: PAYLOAD_MISMATCH_MESSAGE };
    }

    if (!keyRef.current) {
      if (isIndeterminateRef.current) return { ok: false, message: MISSING_RETRY_KEY_MESSAGE };
      keyRef.current = generateUuid();
    }

    if (!isValidUuid(keyRef.current)) {
      if (!isIndeterminateRef.current) keyRef.current = null;
      return {
        ok: false,
        message: isIndeterminateRef.current ? MISSING_RETRY_KEY_MESSAGE : UUID_UNAVAILABLE_MESSAGE,
      };
    }

    lastPayloadRef.current = snapshot;
    return { ok: true, key: keyRef.current };
  };

  /** Applies the submission outcome: success / deterministic refusal release the key. */
  const completeSubmission = (outcome: 'success' | 'deterministic' | 'indeterminate') => {
    if (outcome === 'indeterminate') {
      setIndeterminate(true);
      return;
    }
    keyRef.current = null;
    lastPayloadRef.current = null;
    setIndeterminate(false);
  };

  return { isIndeterminate, isRetrySubmission, prepareSubmission, completeSubmission };
};
