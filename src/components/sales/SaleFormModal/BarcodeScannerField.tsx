import { type ChangeEvent, type KeyboardEvent } from 'react';
import { ScanBarcode, CheckCircle2 } from 'lucide-react';
import styles from './SaleFormModal.module.scss';

export interface BarcodeScannerFieldProps {
  value: string;
  onChange: (value: string) => void;
  onScan: (barcode: string) => void;
  error: string | null;
  successMessage: string | null;
  inputRef: React.RefObject<HTMLInputElement | null>;
  /** Disabled while the sale is being conducted. */
  disabled?: boolean;
}

export const BarcodeScannerField = ({
  value,
  onChange,
  onScan,
  error,
  successMessage,
  inputRef,
  disabled = false,
}: BarcodeScannerFieldProps) => {
  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    onChange(e.target.value);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      // Hardware scanners terminate with Enter: never submit the surrounding form
      e.preventDefault();
      e.stopPropagation();
      if (!disabled) {
        onScan(value);
      }
    }
  };

  const describedBy = error
    ? 'sale-barcode-err'
    : successMessage
    ? 'sale-barcode-success'
    : 'sale-barcode-hint';

  return (
    <div className={styles.barcodeScannerSection}>
      <label htmlFor="sale-barcode-scanner" className={styles.label}>
        Штрихкод товара
      </label>

      <div className={styles.scannerInputWrapper}>
        <ScanBarcode size={18} className={styles.scannerIcon} aria-hidden="true" />
        <input
          id="sale-barcode-scanner"
          ref={inputRef}
          type="text"
          className={styles.scannerInput}
          placeholder="Отсканируйте или введите штрихкод"
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={describedBy}
          autoComplete="off"
        />
      </div>

      <span id="sale-barcode-hint" className={styles.scannerHint}>
        Сканируйте товар — он автоматически добавится в чек
      </span>

      {error && (
        <span id="sale-barcode-err" className={styles.errorText} role="alert">
          {error}
        </span>
      )}

      {successMessage && !error && (
        <span
          id="sale-barcode-success"
          className={styles.scannerSuccess}
          role="status"
          aria-live="polite"
        >
          <CheckCircle2 size={14} className={styles.successIcon} aria-hidden="true" />
          <span>{successMessage}</span>
        </span>
      )}
    </div>
  );
};
