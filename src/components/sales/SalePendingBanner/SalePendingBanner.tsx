import { AlertCircle } from 'lucide-react';
import { PAYMENT_METHODS, type PendingSaleOperation } from '../../../types';
import styles from './SalePendingBanner.module.scss';

export interface SalePendingBannerProps {
  pendingOperation: PendingSaleOperation | null;
  isResolving: boolean;
  isLoading: boolean;
  onResolve: () => void;
}

export const SalePendingBanner = ({
  pendingOperation,
  isResolving,
  isLoading,
  onResolve,
}: SalePendingBannerProps) => {
  if (!pendingOperation) return null;

  const paymentLabel = PAYMENT_METHODS[pendingOperation.payload.paymentMethod];
  const itemsCount = pendingOperation.payload.items.length;

  return (
    <aside className={styles.pendingBanner} role="status" aria-live="polite">
      <div className={styles.pendingBannerText}>
        <AlertCircle size={18} aria-hidden="true" />
        <span>
          Имеется незавершённая отправка чека («{paymentLabel}», позиций: {itemsCount}). Проверьте статус перед оформлением новой продажи.
        </span>
      </div>
      <button
        type="button"
        data-resolve-pending-sale-btn
        className={styles.resolvePendingBtn}
        onClick={onResolve}
        disabled={isResolving || isLoading}
      >
        {isResolving ? 'Проверка...' : 'Проверить статус'}
      </button>
    </aside>
  );
};
