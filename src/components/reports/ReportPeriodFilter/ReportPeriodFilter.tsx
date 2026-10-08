import { useState, type ChangeEvent } from 'react';
import { Calendar, Download } from 'lucide-react';
import type { ReportPeriod, ReportDateRange } from '../../../types';
import { REPORT_PERIODS } from '../../../types';
import { validateReportDateRange } from '../../../utils/reportUtils';
import { formatCalendarDateKey } from '../../../utils/dateUtils';
import styles from './ReportPeriodFilter.module.scss';

export interface ReportPeriodFilterProps {
  period: ReportPeriod;
  onPeriodChange: (period: ReportPeriod) => void;
  dateRange: ReportDateRange;
  onDateRangeChange: (dateRange: ReportDateRange) => void;
  currentDateKey?: string;
  onExportCSV: () => void;
  isExportDisabled: boolean;
  exportButtonLabel?: string;
}

export const ReportPeriodFilter = ({
  period,
  onPeriodChange,
  dateRange,
  onDateRangeChange,
  currentDateKey,
  onExportCSV,
  isExportDisabled,
  exportButtonLabel = 'Экспорт в CSV',
}: ReportPeriodFilterProps) => {
  const todayKey = currentDateKey || formatCalendarDateKey(new Date());

  // Local draft state for custom date inputs
  const [prevProps, setPrevProps] = useState({
    from: dateRange.from,
    to: dateRange.to,
    period,
  });
  const [dateDraft, setDateDraft] = useState<ReportDateRange>({
    from: dateRange.from,
    to: dateRange.to,
  });

  if (
    prevProps.from !== dateRange.from ||
    prevProps.to !== dateRange.to ||
    prevProps.period !== period
  ) {
    setPrevProps({
      from: dateRange.from,
      to: dateRange.to,
      period,
    });
    setDateDraft({
      from: dateRange.from,
      to: dateRange.to,
    });
  }

  const dateErrors =
    period === 'custom'
      ? validateReportDateRange(dateDraft.from, dateDraft.to, todayKey)
      : {};

  const hasDateErrors = Boolean(dateErrors.from || dateErrors.to);

  const handlePeriodChange = (e: ChangeEvent<HTMLSelectElement>) => {
    const newPeriod = e.target.value as ReportPeriod;
    if (newPeriod !== 'custom') {
      setDateDraft({ from: '', to: '' });
      onDateRangeChange({ from: '', to: '' });
      onPeriodChange(newPeriod);
    } else {
      onPeriodChange('custom');
    }
  };

  const handleDateFromChange = (e: ChangeEvent<HTMLInputElement>) => {
    const newFrom = e.target.value;
    const newDraft = { ...dateDraft, from: newFrom };
    setDateDraft(newDraft);
    onDateRangeChange(newDraft);
  };

  const handleDateToChange = (e: ChangeEvent<HTMLInputElement>) => {
    const newTo = e.target.value;
    const newDraft = { ...dateDraft, to: newTo };
    setDateDraft(newDraft);
    onDateRangeChange(newDraft);
  };

  const isExportBlocked = isExportDisabled || (period === 'custom' && hasDateErrors);

  return (
    <div className={styles.filterContainer}>
      <div className={styles.topRow}>
        <div className={styles.leftGroup}>
          <div className={styles.selectWrapper}>
            <Calendar size={16} className={styles.selectIcon} aria-hidden="true" />
            <select
              className={styles.select}
              value={period}
              onChange={handlePeriodChange}
              aria-label="Выбор периода отчёта"
            >
              {(Object.keys(REPORT_PERIODS) as ReportPeriod[]).map((p) => (
                <option key={p} value={p}>
                  {REPORT_PERIODS[p]}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className={styles.rightGroup}>
          <button
            type="button"
            className={styles.exportButton}
            onClick={onExportCSV}
            disabled={isExportBlocked}
            title={
              hasDateErrors && period === 'custom'
                ? 'Исправьте ошибки в диапазоне дат перед экспортом'
                : isExportDisabled
                ? 'Нет данных для экспорта'
                : exportButtonLabel
            }
            aria-label={exportButtonLabel}
          >
            <Download size={16} aria-hidden="true" />
            <span>{exportButtonLabel}</span>
          </button>
        </div>
      </div>

      {period === 'custom' && (
        <div className={styles.customDateRow} role="group" aria-label="Выбор произвольного диапазона дат">
          <div className={styles.dateFieldGroup}>
            <span className={styles.dateLabel}>С:</span>
            <input
              type="date"
              className={`${styles.dateInput} ${dateErrors.from && dateDraft.from ? styles.inputError : ''}`}
              value={dateDraft.from}
              max={dateDraft.to || todayKey}
              onChange={handleDateFromChange}
              aria-label="Дата начала периода"
            />
          </div>

          <div className={styles.dateFieldGroup}>
            <span className={styles.dateLabel}>По:</span>
            <input
              type="date"
              className={`${styles.dateInput} ${dateErrors.to && dateDraft.to ? styles.inputError : ''}`}
              value={dateDraft.to}
              min={dateDraft.from || undefined}
              max={todayKey}
              onChange={handleDateToChange}
              aria-label="Дата окончания периода"
            />
          </div>

          {(dateErrors.from || dateErrors.to) && (
            <span className={styles.errorMessage} role="alert">
              {!dateDraft.from && !dateDraft.to
                ? 'Выберите даты начала и окончания периода'
                : dateErrors.from || dateErrors.to}
            </span>
          )}
        </div>
      )}
    </div>
  );
};
