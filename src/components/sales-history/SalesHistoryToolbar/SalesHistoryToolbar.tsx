import { useState, useRef, type ChangeEvent } from 'react';
import { Search, X, RotateCcw, Download, Calendar } from 'lucide-react';
import type {
  SalesHistoryFilters,
  SalesHistoryPeriod,
  PaymentMethod,
  SalesHistoryDateRangeDraft,
} from '../../../types';
import { PAYMENT_METHODS } from '../../../types';
import { validateDateRange } from '../../../utils/salesHistoryUtils';
import { formatCalendarDateKey } from '../../../utils/dateUtils';
import styles from './SalesHistoryToolbar.module.scss';

export interface SalesHistoryToolbarProps {
  filters: SalesHistoryFilters;
  onFilterChange: (filters: SalesHistoryFilters) => void;
  onResetFilters: () => void;
  onExport: () => void;
  isExportDisabled: boolean;
  currentDateKey?: string;
  searchInputRef?: React.RefObject<HTMLInputElement | null>;
}

export const SalesHistoryToolbar = ({
  filters,
  onFilterChange,
  onResetFilters,
  onExport,
  isExportDisabled,
  currentDateKey,
  searchInputRef,
}: SalesHistoryToolbarProps) => {
  const localSearchInputRef = useRef<HTMLInputElement>(null);
  const effectiveSearchRef = searchInputRef ?? localSearchInputRef;

  const todayKey = currentDateKey || formatCalendarDateKey(new Date());

  // Local draft state for custom date range inputs with render-time sync
  const [prevProps, setPrevProps] = useState({
    dateFrom: filters.dateFrom,
    dateTo: filters.dateTo,
    period: filters.period,
  });
  const [dateDraft, setDateDraft] = useState<SalesHistoryDateRangeDraft>({
    from: filters.dateFrom,
    to: filters.dateTo,
  });

  if (
    prevProps.dateFrom !== filters.dateFrom ||
    prevProps.dateTo !== filters.dateTo ||
    prevProps.period !== filters.period
  ) {
    setPrevProps({
      dateFrom: filters.dateFrom,
      dateTo: filters.dateTo,
      period: filters.period,
    });
    setDateDraft({
      from: filters.dateFrom,
      to: filters.dateTo,
    });
  }

  const dateErrors =
    filters.period === 'custom'
      ? validateDateRange(dateDraft.from, dateDraft.to, todayKey)
      : {};

  const hasDateErrors = Boolean(dateErrors.from || dateErrors.to);

  const hasActiveFilters =
    Boolean(filters.searchQuery.trim()) ||
    filters.period !== 'all' ||
    filters.paymentMethod !== 'all' ||
    Boolean(filters.dateFrom) ||
    Boolean(filters.dateTo) ||
    Boolean(dateDraft.from) ||
    Boolean(dateDraft.to);

  const handleSearchChange = (e: ChangeEvent<HTMLInputElement>) => {
    onFilterChange({
      ...filters,
      searchQuery: e.target.value,
    });
  };

  const handlePaymentMethodChange = (e: ChangeEvent<HTMLSelectElement>) => {
    onFilterChange({
      ...filters,
      paymentMethod: e.target.value as PaymentMethod | 'all',
    });
  };

  const handlePeriodChange = (e: ChangeEvent<HTMLSelectElement>) => {
    const newPeriod = e.target.value as SalesHistoryPeriod;
    if (newPeriod !== 'custom') {
      setDateDraft({ from: '', to: '' });
      onFilterChange({
        ...filters,
        period: newPeriod,
        dateFrom: '',
        dateTo: '',
      });
    } else {
      onFilterChange({
        ...filters,
        period: 'custom',
      });
    }
  };

  const handleDateFromChange = (e: ChangeEvent<HTMLInputElement>) => {
    const newFrom = e.target.value;
    const newDraft = { ...dateDraft, from: newFrom };
    setDateDraft(newDraft);

    const errors = validateDateRange(newDraft.from, newDraft.to, todayKey);
    if (!errors.from && !errors.to) {
      onFilterChange({
        ...filters,
        period: 'custom',
        dateFrom: newDraft.from,
        dateTo: newDraft.to,
      });
    }
  };

  const handleDateToChange = (e: ChangeEvent<HTMLInputElement>) => {
    const newTo = e.target.value;
    const newDraft = { ...dateDraft, to: newTo };
    setDateDraft(newDraft);

    const errors = validateDateRange(newDraft.from, newDraft.to, todayKey);
    if (!errors.from && !errors.to) {
      onFilterChange({
        ...filters,
        period: 'custom',
        dateFrom: newDraft.from,
        dateTo: newDraft.to,
      });
    }
  };

  const handleClearSearch = () => {
    onFilterChange({
      ...filters,
      searchQuery: '',
    });
    effectiveSearchRef.current?.focus();
  };

  const exportBlocked = isExportDisabled || hasDateErrors;

  return (
    <div className={styles.toolbarContainer}>
      <div className={styles.topRow}>
        <div className={styles.leftControls}>
          {/* Search input */}
          <div className={styles.searchWrapper}>
            <Search size={16} className={styles.searchIcon} aria-hidden="true" />
            <input
              ref={effectiveSearchRef}
              type="search"
              data-sales-history-search
              className={styles.searchInput}
              placeholder="Поиск по чеку, товару, артикулу"
              value={filters.searchQuery}
              onChange={handleSearchChange}
              aria-label="Поиск по номеру чека, товару или артикулу"
            />
            {filters.searchQuery && (
              <button
                type="button"
                className={styles.clearSearchBtn}
                onClick={handleClearSearch}
                aria-label="Очистить поиск"
              >
                <X size={14} />
              </button>
            )}
          </div>

          {/* Payment method filter */}
          <div className={styles.selectWrapper}>
            <select
              className={styles.select}
              value={filters.paymentMethod}
              onChange={handlePaymentMethodChange}
              aria-label="Фильтр по способу оплаты"
            >
              <option value="all">Все способы оплаты</option>
              {(Object.keys(PAYMENT_METHODS) as PaymentMethod[]).map((pm) => (
                <option key={pm} value={pm}>
                  {PAYMENT_METHODS[pm]}
                </option>
              ))}
            </select>
          </div>

          {/* Period filter */}
          <div className={styles.selectWrapper}>
            <select
              className={styles.select}
              value={filters.period}
              onChange={handlePeriodChange}
              aria-label="Фильтр по периоду"
            >
              <option value="all">Все периоды</option>
              <option value="today">Сегодня</option>
              <option value="week">За 7 дней</option>
              <option value="month">За 30 дней</option>
              <option value="custom">Произвольный период</option>
            </select>
          </div>

          {/* Reset filters button */}
          {hasActiveFilters && (
            <button
              type="button"
              className={styles.resetButton}
              onClick={onResetFilters}
              title="Сбросить все фильтры"
            >
              <RotateCcw size={14} />
              <span>Сбросить</span>
            </button>
          )}
        </div>

        <div className={styles.rightControls}>
          {/* Export to CSV */}
          <button
            type="button"
            className={styles.exportButton}
            onClick={onExport}
            disabled={exportBlocked}
            title={
              hasDateErrors
                ? 'Исправьте ошибки в диапазоне дат перед экспортом'
                : isExportDisabled
                ? 'Нет данных для экспорта'
                : 'Экспортировать журнал продаж в CSV'
            }
            aria-label="Экспортировать журнал продаж в CSV"
          >
            <Download size={16} />
            <span>Экспорт в CSV</span>
          </button>
        </div>
      </div>

      {/* Custom Date Range Picker Row */}
      {filters.period === 'custom' && (
        <div className={styles.customDateRow} role="group" aria-label="Выбор произвольного периода">
          <div className={styles.dateFieldGroup}>
            <Calendar size={16} className={styles.dateIcon} aria-hidden="true" />
            <span className={styles.dateLabel}>С:</span>
            <input
              type="date"
              className={`${styles.dateInput} ${dateErrors.from ? styles.inputError : ''}`}
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
              className={`${styles.dateInput} ${dateErrors.to ? styles.inputError : ''}`}
              value={dateDraft.to}
              min={dateDraft.from || undefined}
              max={todayKey}
              onChange={handleDateToChange}
              aria-label="Дата окончания периода"
            />
          </div>

          {(dateErrors.from || dateErrors.to) && (
            <span className={styles.errorMessage} role="alert">
              {dateErrors.from || dateErrors.to}
            </span>
          )}
        </div>
      )}
    </div>
  );
};
