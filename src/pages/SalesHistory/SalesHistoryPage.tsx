import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import type {
  Sale,
  SalesHistoryFilters,
  SalesHistorySort,
} from '../../types';
import { useInventory } from '../../context';
import { formatCalendarDateKey } from '../../utils/dateUtils';
import {
  filterSalesHistory,
  sortSalesHistory,
  calculateSalesHistorySummary,
  exportSalesHistoryToCSV,
} from '../../utils/salesHistoryUtils';
import {
  SalesHistoryStats,
  SalesHistoryToolbar,
  SalesHistoryTable,
} from '../../components/sales-history';
import { SaleViewModal } from '../../components/sales';
import { Pagination } from '../../components/warehouse/Pagination/Pagination';
import styles from './SalesHistoryPage.module.scss';

export const SalesHistoryPage = () => {
  const { sales } = useInventory();

  // Filters state
  const [filters, setFilters] = useState<SalesHistoryFilters>({
    searchQuery: '',
    period: 'all',
    paymentMethod: 'all',
    dateFrom: '',
    dateTo: '',
  });

  // Sorting state
  const [sort, setSort] = useState<SalesHistorySort>({
    field: 'soldAt',
    direction: 'desc',
  });

  // Pagination state (10 items per page)
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 10;

  // Modal state for receipt details
  const [saleToView, setSaleToView] = useState<Sale | null>(null);

  // Search input ref for accessible focus restoration
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Keep track of current calendar date (YYYY-MM-DD) to refresh date-dependent calculations across midnight / tab focus
  const [currentDateKey, setCurrentDateKey] = useState(() =>
    formatCalendarDateKey(new Date())
  );

  useEffect(() => {
    const updateDate = () => {
      const newKey = formatCalendarDateKey(new Date());
      setCurrentDateKey((prev) => (prev !== newKey ? newKey : prev));
    };

    const handleFocus = () => updateDate();
    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleFocus);
    const interval = setInterval(updateDate, 30_000);

    return () => {
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleFocus);
      clearInterval(interval);
    };
  }, []);

  // Filtered sales based on search query, payment method, and period
  const filteredSales = useMemo(() => {
    return filterSalesHistory(sales, filters, currentDateKey);
  }, [sales, filters, currentDateKey]);

  // Sorted sales
  const sortedSales = useMemo(() => {
    return sortSalesHistory(filteredSales, sort);
  }, [filteredSales, sort]);

  // Dynamic statistics computed over filtered sales
  const stats = useMemo(() => {
    return calculateSalesHistorySummary(filteredSales);
  }, [filteredSales]);

  // Pagination calculations
  const totalPages = Math.ceil(sortedSales.length / pageSize) || 1;
  const safeCurrentPage = Math.min(currentPage, totalPages);

  const paginatedSales = useMemo(() => {
    const startIndex = (safeCurrentPage - 1) * pageSize;
    return sortedSales.slice(startIndex, startIndex + pageSize);
  }, [sortedSales, safeCurrentPage, pageSize]);

  const hasActiveFilters =
    Boolean(filters.searchQuery.trim()) ||
    filters.period !== 'all' ||
    filters.paymentMethod !== 'all' ||
    Boolean(filters.dateFrom) ||
    Boolean(filters.dateTo);

  const handleFilterChange = useCallback((newFilters: SalesHistoryFilters) => {
    setFilters(newFilters);
    setCurrentPage(1);
  }, []);

  const handleSortChange = useCallback((newSort: SalesHistorySort) => {
    setSort(newSort);
    setCurrentPage(1);
  }, []);

  const handleResetFilters = useCallback(() => {
    setFilters({
      searchQuery: '',
      period: 'all',
      paymentMethod: 'all',
      dateFrom: '',
      dateTo: '',
    });
    setCurrentPage(1);
    requestAnimationFrame(() => {
      const input =
        searchInputRef.current ??
        document.querySelector<HTMLInputElement>(
          '[data-sales-history-search]'
        );
      if (input && document.contains(input)) {
        input.focus();
      }
    });
  }, []);

  const handleExportCSV = useCallback(() => {
    if (sortedSales.length === 0) return;
    exportSalesHistoryToCSV(sortedSales, currentDateKey);
  }, [sortedSales, currentDateKey]);

  const handleViewSale = useCallback((s: Sale) => {
    setSaleToView(s);
  }, []);

  const handleCloseViewModal = useCallback(() => {
    setSaleToView(null);
  }, []);

  return (
    <div className={styles.salesHistoryPage}>
      {/* Header */}
      <div className={styles.pageHeader}>
        <div className={styles.headerTitles}>
          <h1 className={styles.title}>История продаж</h1>
          <p className={styles.subtitle}>
            Журнал фискальных чеков и детальный аудит транзакций
          </p>
        </div>
      </div>

      {/* 4 Dynamic Statistics Cards */}
      <SalesHistoryStats summary={stats} />

      {/* Toolbar / Filters & Export */}
      <SalesHistoryToolbar
        filters={filters}
        onFilterChange={handleFilterChange}
        onResetFilters={handleResetFilters}
        onExport={handleExportCSV}
        isExportDisabled={sortedSales.length === 0}
        currentDateKey={currentDateKey}
        searchInputRef={searchInputRef}
      />

      {/* Sales History Table */}
      <SalesHistoryTable
        sales={paginatedSales}
        totalCount={sales.length}
        sort={sort}
        onSortChange={handleSortChange}
        hasActiveFilters={hasActiveFilters}
        onResetFilters={handleResetFilters}
        onViewSale={handleViewSale}
      />

      {/* Pagination */}
      {sortedSales.length > pageSize && (
        <Pagination
          currentPage={safeCurrentPage}
          totalPages={totalPages}
          onPageChange={setCurrentPage}
          totalItems={sortedSales.length}
          pageSize={pageSize}
          itemLabel="чеков"
        />
      )}

      {/* Receipt View Modal */}
      <SaleViewModal
        isOpen={Boolean(saleToView)}
        sale={saleToView}
        onClose={handleCloseViewModal}
        fallbackFocusSelector="[data-sales-history-search]"
      />
    </div>
  );
};
