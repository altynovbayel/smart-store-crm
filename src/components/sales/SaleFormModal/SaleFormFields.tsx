import styles from './SaleFormModal.module.scss';

export interface SaleFormFieldsProps {
  soldAt: string;
  responsiblePerson: string;
  comment: string;
  errors: Record<string, string>;
  disabled: boolean;
  onSoldAtChange: (value: string) => void;
  onCommentChange: (value: string) => void;
}

/**
 * Receipt header fields: sale date, responsible employee (read-only, from the current profile)
 * and receipt comment.
 */
export const SaleFormFields = ({
  soldAt,
  responsiblePerson,
  comment,
  errors,
  disabled,
  onSoldAtChange,
  onCommentChange,
}: SaleFormFieldsProps) => (
  <div className={styles.fieldGrid}>
    <div className={styles.formGroup}>
      <label htmlFor="sale-sold-at" className={styles.label}>
        Дата и время продажи <span className={styles.requiredStar}>*</span>
      </label>
      <input
        id="sale-sold-at"
        type="datetime-local"
        step="1"
        className={styles.input}
        value={soldAt}
        disabled={disabled}
        onChange={(e) => onSoldAtChange(e.target.value)}
        aria-invalid={errors.soldAt ? 'true' : undefined}
        aria-describedby={errors.soldAt ? 'sale-sold-at-err' : undefined}
      />
      {errors.soldAt && (
        <span id="sale-sold-at-err" className={styles.errorText} role="alert">
          {errors.soldAt}
        </span>
      )}
    </div>

    <div className={styles.formGroup}>
      <label htmlFor="sale-responsible" className={styles.label}>
        Ответственный <span className={styles.requiredStar}>*</span>
      </label>
      <input
        id="sale-responsible"
        type="text"
        className={styles.input}
        value={responsiblePerson}
        readOnly
        title="Ответственный определяется автоматически по текущей учётной записи"
        aria-invalid={errors.responsiblePerson ? 'true' : undefined}
        aria-describedby={errors.responsiblePerson ? 'sale-resp-err' : undefined}
      />
      {errors.responsiblePerson && (
        <span id="sale-resp-err" className={styles.errorText} role="alert">
          {errors.responsiblePerson}
        </span>
      )}
    </div>

    <div className={styles.formGroup}>
      <label htmlFor="sale-comment" className={styles.label}>
        Комментарий к чеку
      </label>
      <input
        id="sale-comment"
        type="text"
        className={styles.input}
        placeholder="Примечание (необязательно)"
        value={comment}
        disabled={disabled}
        onChange={(e) => onCommentChange(e.target.value)}
      />
    </div>
  </div>
);
