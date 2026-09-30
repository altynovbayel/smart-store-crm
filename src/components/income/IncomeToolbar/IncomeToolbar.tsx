import { useRef, type ChangeEvent } from 'react';
import { Search, X, RotateCcw, Plus } from 'lucide-react';
import type { IncomeFilters, IncomePeriodFilter } from '../../../types';
import styles from './IncomeToolbar.module.scss';

export interface IncomeToolbarProps {
  filters: IncomeFilters;
  onFilterChange: (filters: IncomeFilters) => void;
  onResetFilters: () => void;
  onOpenCreateModal: () => void;
}

export const IncomeToolbar = ({
  filters,
  onFilterChange,
  onResetFilters,
  onOpenCreateModal,
}: IncomeToolbarProps) => {
  const searchInputRef = useRef<HTMLInputElement>(null);

  const hasActiveFilters =
    Boolean(filters.searchQuery.trim()) || filters.period !== 'all';

  const handleSearchChange = (e: ChangeEvent<HTMLInputElement>) => {
    onFilterChange({
      ...filters,
      searchQuery: e.target.value,
    });
  };

  const handlePeriodChange = (e: ChangeEvent<HTMLSelectElement>) => {
    onFilterChange({
      ...filters,
      period: e.target.value as IncomePeriodFilter,
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
            placeholder="Поиск по номеру, поставщику или документу"
            value={filters.searchQuery}
            onChange={handleSearchChange}
            aria-label="Поиск по номеру накладной, поставщику или документу"
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
          data-add-income-btn
          className={styles.primaryButton}
          onClick={onOpenCreateModal}
          title="Оформить новое поступление товара"
        >
          <Plus size={16} />
          <span>Новый приход</span>
        </button>
      </div>
    </div>
  );
};
