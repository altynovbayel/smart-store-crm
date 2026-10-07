import { useRef, type ChangeEvent } from 'react';
import { Search, X, RotateCcw, Plus } from 'lucide-react';
import type {
  SaleFilters,
  SalePeriodFilter,
  PaymentMethod,
} from '../../../types';
import { PAYMENT_METHODS } from '../../../types';
import styles from './SalesToolbar.module.scss';

export interface SalesToolbarProps {
  filters: SaleFilters;
  onFilterChange: (filters: SaleFilters) => void;
  onResetFilters: () => void;
  onOpenCreateModal: () => void;
  searchInputRef?: React.RefObject<HTMLInputElement | null>;
}

export const SalesToolbar = ({
  filters,
  onFilterChange,
  onResetFilters,
  onOpenCreateModal,
  searchInputRef,
}: SalesToolbarProps) => {
  const localSearchInputRef = useRef<HTMLInputElement>(null);
  const effectiveSearchRef = searchInputRef ?? localSearchInputRef;

  const hasActiveFilters =
    Boolean(filters.searchQuery.trim()) ||
    filters.period !== 'all' ||
    filters.paymentMethod !== 'all';

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
    onFilterChange({
      ...filters,
      period: e.target.value as SalePeriodFilter,
    });
  };

  const handleClearSearch = () => {
    onFilterChange({
      ...filters,
      searchQuery: '',
    });
    effectiveSearchRef.current?.focus();
  };

  const handleResetFilters = () => {
    onResetFilters();
  };

  return (
    <div className={styles.toolbarContainer}>
      <div className={styles.leftControls}>
        {/* Search input */}
        <div className={styles.searchWrapper}>
          <Search size={16} className={styles.searchIcon} aria-hidden="true" />
          <input
            ref={effectiveSearchRef}
            type="search"
            data-sales-search
            className={styles.searchInput}
            placeholder="Поиск по чеку, товару или артикулу"
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
          data-add-sale-btn
          className={styles.primaryButton}
          onClick={onOpenCreateModal}
          title="Оформить новую продажу"
        >
          <Plus size={16} />
          <span>Новая продажа</span>
        </button>
      </div>
    </div>
  );
};
