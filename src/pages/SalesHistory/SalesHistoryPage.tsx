import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { AlertCircle, RotateCcw } from 'lucide-react';
import type {
  Sale,
  SalesHistoryFilters,
  SalesHistorySort,
} from '../../types';
import { useAuth } from '../../context';
import { formatCalendarDateKey } from '../../utils/dateUtils';
import { getSalesHistoryServerRange } from '../../utils/salesHistoryRange';
import { useSalesHistoryData } from './hooks/useSalesHistoryData';
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

/**
 * Sales history works directly with Supabase (sales + sale_items snapshots); InventoryContext is not used.
 * - "Все": archive of the latest receipts (fetch limit 5000);
 * - other periods: the server loads the calendar range [from, before), the existing client filter
 *   keeps the exact UI semantics; search / payment / sort / pagination are client-side.
 */
export const SalesHistoryPage = () => {
  const { user, isAdmin } = useAuth();
  const userId = user?.id ?? null;

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
  const saleToViewRef = useRef<Sale | null>(saleToView);
  useEffect(() => {
    saleToViewRef.current = saleToView;
  }, [saleToView]);
  const isModalOpen = useCallback(() => Boolean(saleToViewRef.current), []);

  // Close the receipt on user switch, logout or role change
  const accessKey = `${userId ?? ''}|${isAdmin ? 'admin' : 'staff'}`;
  const [prevAccessKey, setPrevAccessKey] = useState<string>(accessKey);
  if (prevAccessKey !== accessKey) {
    setPrevAccessKey(accessKey);
    setSaleToView(null);
  }

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

  // Server range depends only on the period / custom dates and the calendar day
  const serverRange = useMemo(
    () =>
      getSalesHistoryServerRange(
        { period: filters.period, dateFrom: filters.dateFrom, dateTo: filters.dateTo },
        currentDateKey
      ),
    [filters.period, filters.dateFrom, filters.dateTo, currentDateKey]
  );

  const { sales, isLoading, loadError, isTruncated, hasAnySales, retry } = useSalesHistoryData({
    userId,
    isAdmin,
    range: serverRange,
    isModalOpen,
  });

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

  // Never export a partial or stale report while the range is loading or failed
  const isExportDisabled = sortedSales.length === 0 || isLoading || Boolean(loadError);

  const handleExportCSV = useCallback(() => {
    if (isExportDisabled) return;
    exportSalesHistoryToCSV(sortedSales, currentDateKey);
  }, [isExportDisabled, sortedSales, currentDateKey]);

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

      {/* Truncated archive notice */}
      {isTruncated && !isLoading && (
        <div className={styles.truncatedNotice} role="note">
          <AlertCircle size={16} aria-hidden="true" />
          <span>
            {serverRange.kind === 'all'
              ? `Показан архив последних ${sales.length} чеков (достигнут лимит выборки).`
              : `За выбранный период загружены последние ${sales.length} чеков (достигнут лимит выборки).`}{' '}
            Статистика, таблица и CSV рассчитаны только по загруженным чекам — сузьте период для полного отчёта.
          </span>
        </div>
      )}

      {/* Load error with retry */}
      {loadError && (
        <div className={styles.errorBanner} role="alert">
          <div className={styles.errorInfo}>
            <AlertCircle size={20} />
            <span className={styles.errorText}>{loadError}</span>
          </div>
          <button
            type="button"
            data-retry-sales-history-btn
            className={styles.retryBtn}
            onClick={retry}
            disabled={isLoading}
          >
            <RotateCcw size={14} />
            <span>{isLoading ? 'Загрузка...' : 'Повторить'}</span>
          </button>
        </div>
      )}

      {/* 4 Dynamic Statistics Cards */}
      <SalesHistoryStats summary={stats} />

      {/* Toolbar / Filters & Export */}
      <SalesHistoryToolbar
        filters={filters}
        onFilterChange={handleFilterChange}
        onResetFilters={handleResetFilters}
        onExport={handleExportCSV}
        isExportDisabled={isExportDisabled}
        currentDateKey={currentDateKey}
        searchInputRef={searchInputRef}
      />

      {/* Sales History Table with Loading State */}
      {isLoading ? (
        <div className={styles.tableLoadingCard}>
          <div className={styles.spinner} role="progressbar" aria-label="Загрузка истории продаж" />
          <span className={styles.loadingText}>Загрузка истории продаж...</span>
        </div>
      ) : (
        <>
          <SalesHistoryTable
            sales={paginatedSales}
            totalCount={sales.length}
            sort={sort}
            onSortChange={handleSortChange}
            hasActiveFilters={hasActiveFilters}
            onResetFilters={handleResetFilters}
            onViewSale={handleViewSale}
            hasAnySales={loadError ? null : hasAnySales}
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
        </>
      )}

      {/* Receipt View Modal */}
      <SaleViewModal
        isOpen={Boolean(saleToView)}
        sale={saleToView}
        onClose={handleCloseViewModal}
        fallbackFocusSelector="[data-sales-history-search]"
        showCostDetails={isAdmin}
      />
    </div>
  );
};
