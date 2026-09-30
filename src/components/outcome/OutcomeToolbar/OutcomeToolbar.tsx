import { useRef, type ChangeEvent } from 'react';
import { Search, X, RotateCcw, Plus } from 'lucide-react';
import type {
  OutcomeFilters,
  OutcomePeriodFilter,
  OutcomeReason,
} from '../../../types';
import { OUTCOME_REASONS } from '../../../types';
import styles from './OutcomeToolbar.module.scss';

export interface OutcomeToolbarProps {
  filters: OutcomeFilters;
  onFilterChange: (filters: OutcomeFilters) => void;
  onResetFilters: () => void;
  onOpenCreateModal: () => void;
}

export const OutcomeToolbar = ({
  filters,
  onFilterChange,
  onResetFilters,
  onOpenCreateModal,
}: OutcomeToolbarProps) => {
  const searchInputRef = useRef<HTMLInputElement>(null);

  const hasActiveFilters =
    Boolean(filters.searchQuery.trim()) ||
    filters.period !== 'all' ||
    filters.reason !== 'all';

  const handleSearchChange = (e: ChangeEvent<HTMLInputElement>) => {
    onFilterChange({
      ...filters,
      searchQuery: e.target.value,
    });
  };

  const handlePeriodChange = (e: ChangeEvent<HTMLSelectElement>) => {
    onFilterChange({
      ...filters,
      period: e.target.value as OutcomePeriodFilter,
    });
  };

  const handleReasonChange = (e: ChangeEvent<HTMLSelectElement>) => {
    onFilterChange({
      ...filters,
      reason: e.target.value as OutcomeReason | 'all',
    });
  };

  const handleClearSearch = () => {
    onFilterChange({
      ...filters,
      searchQuery: '',
    });
    searchInputRef.current?.focus();
  };

  const handleResetFilters = () => {
    onResetFilters();
    searchInputRef.current?.focus();
  };

  return (
    <div className={styles.toolbarContainer}>
      <div className={styles.leftControls}>
        {/* Search input */}
        <div className={styles.searchWrapper}>
          <Search size={16} className={styles.searchIcon} aria-hidden="true" />
          <input
            ref={searchInputRef}
            type="search"
            className={styles.searchInput}
            placeholder="Поиск по номеру, товару или артикулу"
            value={filters.searchQuery}
            onChange={handleSearchChange}
            aria-label="Поиск по номеру списания, товару или артикулу"
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

        {/* Reason filter */}
        <div className={styles.selectWrapper}>
          <select
            className={styles.select}
            value={filters.reason}
            onChange={handleReasonChange}
            aria-label="Фильтр по причине списания"
          >
            <option value="all">Все причины</option>
            {(Object.keys(OUTCOME_REASONS) as OutcomeReason[]).map((r) => (
              <option key={r} value={r}>
                {OUTCOME_REASONS[r]}
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
          </select>
        </div>

        {/* Reset filters button */}
        {hasActiveFilters && (
          <button
            type="button"
            className={styles.resetButton}
            onClick={handleResetFilters}
            title="Сбросить фильтры"
          >
            <RotateCcw size={14} />
            <span>Сбросить</span>
          </button>
        )}
      </div>

      <div className={styles.rightControls}>
        <button
          type="button"
          data-add-outcome-btn
          className={styles.primaryButton}
          onClick={onOpenCreateModal}
          title="Оформить новое списание товара"
        >
          <Plus size={16} />
          <span>Новое списание</span>
        </button>
      </div>
    </div>
  );
};
