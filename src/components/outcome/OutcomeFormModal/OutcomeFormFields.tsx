import type { OutcomeReason } from '../../../types';
import { OUTCOME_REASONS } from '../../../types';
import styles from './OutcomeFormModal.module.scss';

export interface OutcomeFormFieldsProps {
  reason: OutcomeReason;
  documentDate: string;
  responsiblePerson: string;
  comment: string;
  errors: Record<string, string>;
  disabled: boolean;
  onReasonChange: (reason: OutcomeReason) => void;
  onDocumentDateChange: (value: string) => void;
  onCommentChange: (value: string) => void;
}

/**
 * Document-level fields of the outcome form: reason, date, responsible person and comment.
 */
export const OutcomeFormFields = ({
  reason,
  documentDate,
  responsiblePerson,
  comment,
  errors,
  disabled,
  onReasonChange,
  onDocumentDateChange,
  onCommentChange,
}: OutcomeFormFieldsProps) => (
  <div className={styles.fieldsGrid}>
    {/* Причина списания */}
    <div className={styles.formGroup}>
      <label htmlFor="out-reason" className={styles.label}>
        Причина списания <span className={styles.required}>*</span>
      </label>
      <select
        id="out-reason"
        className={styles.select}
        value={reason}
        disabled={disabled}
        onChange={(e) => onReasonChange(e.target.value as OutcomeReason)}
        aria-invalid={errors.reason ? 'true' : undefined}
        aria-describedby={errors.reason ? 'out-reason-error' : undefined}
      >
        {(Object.keys(OUTCOME_REASONS) as OutcomeReason[]).map((r) => (
          <option key={r} value={r}>
            {OUTCOME_REASONS[r]}
          </option>
        ))}
      </select>
      {errors.reason && (
        <span id="out-reason-error" className={styles.errorText} role="alert">
          {errors.reason}
        </span>
      )}
    </div>

    {/* Дата и время списания */}
    <div className={styles.formGroup}>
      <label htmlFor="out-date" className={styles.label}>
        Дата и время списания <span className={styles.required}>*</span>
      </label>
      <input
        id="out-date"
        type="datetime-local"
        step="1"
        className={styles.input}
        value={documentDate}
        disabled={disabled}
        onChange={(e) => onDocumentDateChange(e.target.value)}
        aria-invalid={errors.documentDate ? 'true' : undefined}
        aria-describedby={errors.documentDate ? 'out-date-error' : undefined}
      />

      {errors.documentDate && (
        <span id="out-date-error" className={styles.errorText} role="alert">
          {errors.documentDate}
        </span>
      )}
    </div>

    {/* Ответственный */}
    <div className={styles.formGroup}>
      <label htmlFor="out-responsible" className={styles.label}>
        Ответственный сотрудник
      </label>
      <input
        id="out-responsible"
        type="text"
        className={styles.input}
        value={responsiblePerson}
        readOnly
        disabled={disabled}
        title="Ответственный сотрудник определяется автоматически по текущей учётной записи"
        aria-describedby="out-resp-hint"
      />
      <span id="out-resp-hint" className={styles.fieldHint}>
        Определяется автоматически по текущей учётной записи
      </span>
    </div>

    {/* Примечание / комментарий */}
    <div className={styles.formGroup}>
      <label htmlFor="out-comment" className={styles.label}>
        Комментарий {reason === 'other' && <span className={styles.required}>*</span>}
      </label>
      <textarea
        id="out-comment"
        rows={2}
        className={styles.textarea}
        placeholder={
          reason === 'other'
            ? 'Опишите причину списания подробно (обязательно)...'
            : 'Дополнительные сведения, причина списания или номер акта...'
        }
        value={comment}
        disabled={disabled}
        onChange={(e) => onCommentChange(e.target.value)}
        aria-invalid={errors.comment ? 'true' : undefined}
        aria-describedby={errors.comment ? 'out-comment-error' : undefined}
      />
      {errors.comment && (
        <span id="out-comment-error" className={styles.errorText} role="alert">
          {errors.comment}
        </span>
      )}
    </div>
  </div>
);
