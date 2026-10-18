import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { Plus, CheckCircle2, X, AlertCircle, RotateCcw } from 'lucide-react';
import type { SaleFilters, Sale, SaleSummary } from '../../types';
import { useAuth } from '../../context';
import { calculateSalesSummaryStats, filterSales } from '../../utils/salesPageUtils';
import {
  SalesStats,
  SalesToolbar,
  SalesTable,
  SaleFormModal,
  SaleViewModal,
  SalePendingBanner,
} from '../../components/sales';
import { Pagination } from '../../components/warehouse/Pagination/Pagination';
import { useSalesDateKey } from './hooks/useSalesDateKey';
import { useSalesNotification } from './hooks/useSalesNotification';
import { usePendingSale } from './hooks/usePendingSale';
import { useSalesData } from './hooks/useSalesData';
import { useSaleSubmission } from './hooks/useSaleSubmission';
import styles from './SalesPage.module.scss';

const DEFAULT_FILTERS: SaleFilters = {
  searchQuery: '',
  period: 'all',
  paymentMethod: 'all',
};

const PAGE_SIZE = 8;

/**
 * SalesPage works directly with Supabase (sales, sale_items, products) — InventoryContext is not used.
 * - Sales are conducted only through the transactional RPC rpc_create_sale (idempotent by UUID).
 * - Available to active admins and cashiers (route guard + server get_active_profile(false)).
 */
export const SalesPage = () => {
  const { user, profile } = useAuth();
  const userId = user?.id ?? null;

  // Filters & pagination state
  const [filters, setFilters] = useState<SaleFilters>(DEFAULT_FILTERS);
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = PAGE_SIZE;

  // Modal states
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [saleToView, setSaleToView] = useState<Sale | null>(null);
  const isCreateModalOpenRef = useRef<boolean>(isCreateModalOpen);
  const saleToViewRef = useRef<Sale | null>(saleToView);
  useEffect(() => {
    isCreateModalOpenRef.current = isCreateModalOpen;
  }, [isCreateModalOpen]);
  useEffect(() => {
    saleToViewRef.current = saleToView;
  }, [saleToView]);

  const isAnyModalOpen = useCallback(
    () => isCreateModalOpenRef.current || Boolean(saleToViewRef.current),
    []
  );

  // Close modals on user switch or logout
  const [prevUserId, setPrevUserId] = useState<string | null>(userId);
  if (prevUserId !== userId) {
    setPrevUserId(userId);
    setIsCreateModalOpen(false);
    setSaleToView(null);
  }

  const previousFocusRef = useRef<HTMLElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const currentDateKey = useSalesDateKey();
  const { notification, notify, dismissNotification, toastRef, setIsToastFocused } =
    useSalesNotification(userId, previousFocusRef);

  const { pendingOperation, persistPending, clearPending, confirmPendingFromSales } =
    usePendingSale(userId);

  // If the pending sale is found among loaded receipts, it was committed on the server
  const handleSalesLoaded = useCallback(
    (loadedSales: Sale[]): boolean => {
      const confirmed = confirmPendingFromSales(loadedSales);
      if (!confirmed) return false;
      const receipt = loadedSales.find((s) => s.id === confirmed.id);
      notify(
        receipt
          ? `Чек № ${receipt.receiptNumber} успешно проведён и подтверждён на сервере.`
          : 'Неподтверждённая продажа успешно проведена и подтверждена на сервере.'
      );
      return true;
    },
    [confirmPendingFromSales, notify]
  );

  const {
    sales,
    isLoadingSales: isFetchingSales,
    salesLoadError,
    isSalesTruncated,
    products,
    isLoadingProducts,
    productsLoadError,
    loadSales,
    loadProducts,
    reloadAll,
  } = useSalesData({ userId, isAnyModalOpen, onSalesLoaded: handleSalesLoaded });

  const { isResolvingPending, handleResolvePending, handleCreateSale } = useSaleSubmission({
    userId,
    pendingOperation,
    persistPending,
    clearPending,
    reloadAll,
    refreshProducts: loadProducts,
    notify,
    isAnyModalOpen,
  });

  // Resolving a pending sale counts as receipt loading (disables creation and retry)
  const isLoadingSales = isFetchingSales || isResolvingPending;

  // Dynamic statistics calculated across all loaded receipts
  const stats: SaleSummary = useMemo(
    () => calculateSalesSummaryStats(sales, currentDateKey),
    [sales, currentDateKey]
  );

  // Filter receipts by search query, payment method, and period
  const filteredSales = useMemo(
    () => filterSales(sales, filters, currentDateKey),
    [sales, filters, currentDateKey]
  );

  // Pagination calculation
  const totalPages = Math.ceil(filteredSales.length / pageSize) || 1;
  const safeCurrentPage = Math.min(currentPage, totalPages);

  const paginatedSales = useMemo(() => {
    const startIndex = (safeCurrentPage - 1) * pageSize;
    return filteredSales.slice(startIndex, startIndex + pageSize);
  }, [filteredSales, safeCurrentPage, pageSize]);

  const hasActiveFilters =
    Boolean(filters.searchQuery.trim()) ||
    filters.period !== 'all' ||
    filters.paymentMethod !== 'all';

  const handleResetFilters = useCallback(() => {
    setFilters(DEFAULT_FILTERS);
    setCurrentPage(1);
    requestAnimationFrame(() => {
      const input =
        searchInputRef.current ??
        document.querySelector<HTMLInputElement>('[data-sales-search]');
      if (input && document.contains(input)) {
        input.focus();
      }
    });
  }, []);

  const handleFilterChange = useCallback((newFilters: SaleFilters) => {
    setFilters(newFilters);
    setCurrentPage(1);
  }, []);

  const isCreateDisabled = isLoadingProducts || Boolean(productsLoadError) || isLoadingSales;
  const createDisabledTooltip = productsLoadError
    ? 'Не удалось загрузить каталог товаров'
    : isLoadingProducts
      ? 'Загрузка каталога товаров...'
      : isLoadingSales
        ? 'Загрузка чеков...'
        : undefined;

  const handleOpenCreateModal = useCallback(() => {
    if (isCreateDisabled) return;
    if (document.activeElement instanceof HTMLElement) {
      previousFocusRef.current = document.activeElement;
    }
    setIsCreateModalOpen(true);
    // The form must work with the current catalog: reload prices and stock in the background
    void loadProducts();
  }, [isCreateDisabled, loadProducts]);

  const handleRefreshCatalog = useCallback(() => {
    void loadProducts();
  }, [loadProducts]);

  const handleCloseCreateModal = useCallback(() => {
    setIsCreateModalOpen(false);
  }, []);

  const handleViewSale = useCallback((s: Sale) => {
    setSaleToView(s);
  }, []);

  const handleCloseViewModal = useCallback(() => {
    setSaleToView(null);
  }, []);

  return (
    <div className={styles.salesPage}>
      {/* Header */}
      <div className={styles.pageHeader}>
        <div className={styles.headerTitles}>
          <h1 className={styles.title}>Продажи</h1>
          <p className={styles.subtitle}>
            Розничная продажа аксессуаров и оформление чеков
          </p>
        </div>
        <button
          type="button"
          data-add-sale-btn
          className={styles.addBtnHeader}
          onClick={handleOpenCreateModal}
          disabled={isCreateDisabled}
          title={createDisabledTooltip ?? 'Оформить новую продажу'}
        >
          <Plus size={16} />
          <span>Новая продажа</span>
        </button>
      </div>

      {/* Toast Notification */}
      {notification && (
        <div
          ref={toastRef}
          className={styles.toast}
          role="status"
          aria-live="polite"
          onFocus={() => setIsToastFocused(true)}
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
              setIsToastFocused(false);
            }
          }}
          tabIndex={-1}
        >
          <div className={styles.toastContent}>
            <CheckCircle2 size={18} className={styles.toastIcon} />
            <span>{notification}</span>
          </div>
          <button
            type="button"
            className={styles.toastClose}
            onClick={dismissNotification}
            aria-label="Закрыть уведомление"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Pending Unconfirmed Sale Banner */}
      <SalePendingBanner
        pendingOperation={pendingOperation}
        isResolving={isResolvingPending}
        isLoading={isLoadingSales}
        onResolve={handleResolvePending}
      />

      {/* Truncated receipts notice */}
      {isSalesTruncated && (
        <div className={styles.truncatedNotice} role="note">
          <AlertCircle size={16} aria-hidden="true" />
          <span>
            Показаны последние {sales.length} чеков (достигнут лимит выборки). Более ранние чеки не загружены.
          </span>
        </div>
      )}

      {/* Error Banners with Retry */}
      {salesLoadError && (
        <div className={styles.errorBanner} role="alert">
          <div className={styles.errorInfo}>
            <AlertCircle size={20} />
            <span className={styles.errorText}>{salesLoadError}</span>
          </div>
          <button
            type="button"
            data-retry-sales-btn
            className={styles.retryBtn}
            onClick={() => void loadSales(true)}
            disabled={isLoadingSales}
          >
            <RotateCcw size={14} />
            <span>{isLoadingSales ? 'Загрузка...' : 'Повторить'}</span>
          </button>
        </div>
      )}

      {productsLoadError && (
        <div className={styles.errorBanner} role="alert">
          <div className={styles.errorInfo}>
            <AlertCircle size={20} />
            <span className={styles.errorText}>{productsLoadError}</span>
          </div>
          <button
            type="button"
            data-retry-products-btn
            className={styles.retryBtn}
            onClick={() => void loadProducts(true)}
            disabled={isLoadingProducts}
          >
            <RotateCcw size={14} />
            <span>{isLoadingProducts ? 'Загрузка...' : 'Повторить'}</span>
          </button>
        </div>
      )}

      {/* 4 Stat Cards */}
      <SalesStats summary={stats} />

      {/* Toolbar / Filters */}
      <SalesToolbar
        filters={filters}
        onFilterChange={handleFilterChange}
        onResetFilters={handleResetFilters}
        onOpenCreateModal={handleOpenCreateModal}
        searchInputRef={searchInputRef}
        isCreateDisabled={isCreateDisabled}
        createDisabledTooltip={createDisabledTooltip}
      />

      {/* Table with Loading State */}
      {isLoadingSales && sales.length === 0 ? (
        <div className={styles.tableLoadingCard}>
          <div className={styles.spinner} role="progressbar" aria-label="Загрузка чеков продаж" />
          <span className={styles.loadingText}>Загрузка чеков продаж...</span>
        </div>
      ) : (
        <>
          <SalesTable
            sales={paginatedSales}
            totalCount={sales.length}
            hasActiveFilters={hasActiveFilters}
            onResetFilters={handleResetFilters}
            onOpenCreateModal={handleOpenCreateModal}
            onViewSale={handleViewSale}
            isCreateDisabled={isCreateDisabled}
            createDisabledTooltip={createDisabledTooltip}
          />

          {/* Pagination */}
          {filteredSales.length > pageSize && (
            <Pagination
              currentPage={safeCurrentPage}
              totalPages={totalPages}
              onPageChange={setCurrentPage}
              totalItems={filteredSales.length}
              pageSize={pageSize}
              itemLabel="чеков"
            />
          )}
        </>
      )}

      {/* Modals */}
      {isCreateModalOpen && (
        <SaleFormModal
          isOpen={isCreateModalOpen}
          activeProducts={products}
          initialResponsiblePerson={profile?.full_name}
          pendingOperation={pendingOperation}
          onClose={handleCloseCreateModal}
          onSubmit={handleCreateSale}
          onRefreshCatalog={handleRefreshCatalog}
        />
      )}

      <SaleViewModal
        isOpen={Boolean(saleToView)}
        sale={saleToView}
        onClose={handleCloseViewModal}
      />
    </div>
  );
};
