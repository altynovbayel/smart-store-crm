import { AlertCircle } from 'lucide-react';
import { OUTCOME_REASONS, type PendingOutcomeOperation } from '../../../types';
import styles from './OutcomePendingBanner.module.scss';

export interface OutcomePendingBannerProps {
  pendingOperation: PendingOutcomeOperation | null;
  isResolving: boolean;
  isLoading: boolean;
  onResolve: () => void;
}

export const OutcomePendingBanner = ({
  pendingOperation,
  isResolving,
  isLoading,
  onResolve,
}: OutcomePendingBannerProps) => {
  if (!pendingOperation) return null;

  const reasonLabel = OUTCOME_REASONS[pendingOperation.payload.reason] || pendingOperation.payload.reason;
  const itemsCount = pendingOperation.payload.items.length;

  return (
    <aside className={styles.pendingBanner} role="status" aria-live="polite">
      <div className={styles.pendingBannerText}>
        <AlertCircle size={18} aria-hidden="true" />
        <span>
          Имеется незавершённая отправка документа списания («{reasonLabel}», позиций: {itemsCount}). Проверьте статус перед созданием других документов.
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
