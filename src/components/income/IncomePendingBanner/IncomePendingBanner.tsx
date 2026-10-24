import { AlertCircle } from 'lucide-react';
import type { PendingIncomeOperation } from '../../../types';
import styles from './IncomePendingBanner.module.scss';

export interface IncomePendingBannerProps {
  pendingOperation: PendingIncomeOperation | null;
  isResolving: boolean;
  isLoading: boolean;
  onResolve: () => void;
}

export const IncomePendingBanner = ({
  pendingOperation,
  isResolving,
  isLoading,
  onResolve,
}: IncomePendingBannerProps) => {
  if (!pendingOperation) return null;

  return (
    <aside className={styles.pendingBanner} role="status" aria-live="polite">
      <div className={styles.pendingBannerText}>
        <AlertCircle size={18} aria-hidden="true" />
        <span>
          Имеется незавершённая отправка накладной от «
          {pendingOperation.payload.supplier}». Проверьте статус перед созданием
          других накладных.
        </span>
      </div>
      <button
        type="button"
        data-resolve-pending-btn
        className={styles.resolvePendingBtn}
        onClick={onResolve}
        disabled={isResolving || isLoading}
      >
        {isResolving ? 'Проверка...' : 'Проверить статус'}
      </button>
    </aside>
  );
};
