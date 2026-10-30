import type { RefObject } from 'react';
import { CheckCircle2, X } from 'lucide-react';
import styles from './WarehouseToast.module.scss';

export interface WarehouseToastProps {
  message: string;
  toastRef: RefObject<HTMLDivElement | null>;
  onFocusChange: (isFocused: boolean) => void;
  onDismiss: () => void;
}

/** Success toast of the warehouse page (role="status"; auto-dismiss is handled by the caller). */
export const WarehouseToast = ({ message, toastRef, onFocusChange, onDismiss }: WarehouseToastProps) => (
  <div
    ref={toastRef}
    className={styles.toast}
    role="status"
    onFocus={() => onFocusChange(true)}
    onBlur={(e) => {
      if (!e.currentTarget.contains(e.relatedTarget)) {
        onFocusChange(false);
      }
    }}
  >
    <div className={styles.toastContent}>
      <CheckCircle2 size={18} className={styles.toastIcon} />
      <span>{message}</span>
    </div>
    <button
      type="button"
      className={styles.toastClose}
      onClick={onDismiss}
      aria-label="Закрыть уведомление"
    >
      <X size={14} />
    </button>
  </div>
);
