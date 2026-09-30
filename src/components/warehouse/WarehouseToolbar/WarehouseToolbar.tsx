import { useRef, type ChangeEvent } from 'react';
import {
  Search,
  Filter,
  Download,
  Plus,
  X,
  RotateCcw,
} from 'lucide-react';
import type { ProductCategory, StockStatus, ProductFilters } from '../../../types';
import styles from './WarehouseToolbar.module.scss';

export interface WarehouseToolbarProps {
  filters: ProductFilters;
  onFilterChange: (filters: ProductFilters) => void;
  onResetFilters: () => void;
  onExport: () => void;
  onAddProduct: () => void;
}

export const WarehouseToolbar = ({
  filters,
  onFilterChange,
  onResetFilters,
  onExport,
  onAddProduct,
}: WarehouseToolbarProps) => {
  const searchInputRef = useRef<HTMLInputElement>(null);

  const hasActiveFilters =
    Boolean(filters.searchQuery.trim()) ||
    filters.category !== 'all' ||
    filters.status !== 'all';

  const handleSearchChange = (e: ChangeEvent<HTMLInputElement>) => {
    onFilterChange({
      ...filters,
      searchQuery: e.target.value,
    });
  };

  const handleCategoryChange = (e: ChangeEvent<HTMLSelectElement>) => {
    onFilterChange({
      ...filters,
      category: e.target.value as ProductCategory | 'all',
    });
  };

  const handleStatusChange = (e: ChangeEvent<HTMLSelectElement>) => {
    onFilterChange({
      ...filters,
      status: e.target.value as StockStatus | 'all',
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
            placeholder="Поиск по названию, артикулу или штрихкоду"
            value={filters.searchQuery}
            onChange={handleSearchChange}
            aria-label="Поиск по названию, артикулу или штрихкоду"
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

        {/* Category filter */}
        <div className={styles.selectWrapper}>
          <select
            className={styles.select}
            value={filters.category}
            onChange={handleCategoryChange}
            aria-label="Фильтр по категории"
          >
            <option value="all">Все категории</option>
            <option value="cases">Чехлы</option>
            <option value="cables">Кабели</option>
            <option value="glass">Защитные стёкла</option>
            <option value="powerbanks">Power Bank</option>
            <option value="headphones">Наушники</option>
            <option value="adapters">Адаптеры</option>
            <option value="memory">Карты памяти</option>
            <option value="holders">Автодержатели</option>
          </select>
        </div>

        {/* Status filter */}
        <div className={styles.selectWrapper}>
          <select
            className={styles.select}
            value={filters.status}
            onChange={handleStatusChange}
            aria-label="Фильтр по статусу"
          >
            <option value="all">Все статусы</option>
            <option value="in_stock">В наличии</option>
            <option value="low_stock">Мало</option>
            <option value="out_of_stock">Нет в наличии</option>
          </select>
        </div>

        {/* Reset filter button if active */}
        {hasActiveFilters && (
          <button
            type="button"
            className={styles.resetButton}
            onClick={handleResetFilters}
            title="Сбросить все фильтры"
          >
            <RotateCcw size={14} />
            <span className={styles.btnText}>Сбросить</span>
          </button>
        )}
      </div>

      <div className={styles.rightControls}>
        {/* Filters button (toggle visual indicator) */}
        <button
          type="button"
          className={`${styles.outlineButton} ${hasActiveFilters ? styles.btnActive : ''}`}
          onClick={onResetFilters}
          title={hasActiveFilters ? 'Сбросить фильтры' : 'Все фильтры'}
        >
          <Filter size={16} />
          <span className={styles.btnText}>Фильтры</span>
          {hasActiveFilters && <span className={styles.filterDot} />}
        </button>

        {/* Export to CSV */}
        <button
          type="button"
          className={styles.outlineButton}
          onClick={onExport}
          title="Экспорт в CSV"
        >
          <Download size={16} />
          <span className={styles.btnText}>Экспорт</span>
        </button>

        {/* Add Product button */}
        <button
          type="button"
          data-add-product-btn
          className={styles.primaryButton}
          onClick={onAddProduct}
          title="Добавить новый товар"
        >
          <Plus size={16} />
          <span>Добавить товар</span>
        </button>
      </div>
    </div>
  );
};
