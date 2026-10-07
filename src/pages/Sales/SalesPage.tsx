import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { Plus, CheckCircle2, X } from 'lucide-react';
import type {
  SaleFilters,
  Sale,
  SaleFormData,
  SaleSummary,
} from '../../types';
import { useInventory } from '../../context';
import { isToday, isWithinDays, parseCustomDate, formatCalendarDateKey } from '../../utils/dateUtils';
import { restoreFocusWithFallback } from '../../utils/focusUtils';
import { toCents, fromCents } from '../../utils/incomeCalculations';
import {
  SalesStats,
  SalesToolbar,
  SalesTable,
  SaleFormModal,
  SaleViewModal,
} from '../../components/sales';
import { Pagination } from '../../components/warehouse/Pagination/Pagination';
import styles from './SalesPage.module.scss';

export const SalesPage = () => {
  const { sales, activeProducts, addSale } = useInventory();

  // Filters state
  const [filters, setFilters] = useState<SaleFilters>({
    searchQuery: '',
    period: 'all',
    paymentMethod: 'all',
  });

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 8;

  // Modal states
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [saleToView, setSaleToView] = useState<Sale | null>(null);

  // Notification state and focus management
  const [notification, setNotification] = useState<string | null>(null);
  const [isToastFocused, setIsToastFocused] = useState(false);
  const toastRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Keep track of current calendar date (YYYY-MM-DD) to refresh date-dependent calculations across midnight/tab focus
  const [currentDateKey, setCurrentDateKey] = useState(() => formatCalendarDateKey(new Date()));

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

  // Dismiss notification handler with focus return
  const handleDismissNotification = useCallback(() => {
    if (toastRef.current?.contains(document.activeElement)) {
      restoreFocusWithFallback(
        previousFocusRef.current,
        '[data-add-sale-btn]'
      );
    }
    setNotification(null);
  }, []);

  // Auto-dismiss notification after 6 seconds, pausing if focus is inside toast
  useEffect(() => {
    if (!notification || isToastFocused) return;
    const timer = setTimeout(() => {
      if (toastRef.current?.contains(document.activeElement)) {
        restoreFocusWithFallback(
          previousFocusRef.current,
          '[data-add-sale-btn]'
        );
      }
      setNotification(null);
    }, 6000);
    return () => clearTimeout(timer);
  }, [notification, isToastFocused]);

  // Dynamic statistics calculated across all sales
  const stats: SaleSummary = useMemo(() => {
    let todayRevenueCents = 0;
    let todaySalesCount = 0;
    let todayProfitCents = 0;

    for (const s of sales) {
      if (isToday(s.soldAt, currentDateKey)) {
        todayRevenueCents += toCents(s.totalAmount);
        todaySalesCount += 1;
        todayProfitCents += toCents(s.profitAmount);
      }
    }

    const todayAverageCheck =
      todaySalesCount > 0
        ? fromCents(Math.round(todayRevenueCents / todaySalesCount))
        : 0;

    return {
      todayRevenue: fromCents(todayRevenueCents),
      todaySalesCount,
      todayAverageCheck,
      todayProfit: fromCents(todayProfitCents),
    };
  }, [sales, currentDateKey]);

  // Filter sales by search query, payment method, and period
  const filteredSales = useMemo(() => {
    return sales.filter((s) => {
      // 1. Search Query (receiptNumber, comment, item names, item SKUs)
      if (filters.searchQuery.trim()) {
        const q = filters.searchQuery.trim().toLowerCase();
        const matchNumber = s.receiptNumber.toLowerCase().includes(q);
        const matchComment = s.comment ? s.comment.toLowerCase().includes(q) : false;
        const matchItems = s.items.some(
          (it) =>
            it.productName.toLowerCase().includes(q) ||
            it.sku.toLowerCase().includes(q)
        );
        if (!matchNumber && !matchComment && !matchItems) {
          return false;
        }
      }

      // 2. Payment Method Filter
      if (filters.paymentMethod !== 'all' && s.paymentMethod !== filters.paymentMethod) {
        return false;
      }

      // 3. Period Filter
      if (filters.period === 'today') {
        if (!isToday(s.soldAt, currentDateKey)) return false;
      } else if (filters.period === 'week') {
        if (!isWithinDays(s.soldAt, 7, currentDateKey)) return false;
      } else if (filters.period === 'month') {
        if (!isWithinDays(s.soldAt, 30, currentDateKey)) return false;
      }

      return true;
    })
    .sort((a, b) => {
      const da = parseCustomDate(a.soldAt)?.getTime() ?? 0;
      const db = parseCustomDate(b.soldAt)?.getTime() ?? 0;
      if (da !== db) return db - da;
      const ca = parseCustomDate(a.createdAt)?.getTime() ?? 0;
      const cb = parseCustomDate(b.createdAt)?.getTime() ?? 0;
      if (ca !== cb) return cb - ca;
      return b.id.localeCompare(a.id);
    });
  }, [sales, filters, currentDateKey]);

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
    setFilters({
      searchQuery: '',
      period: 'all',
      paymentMethod: 'all',
    });
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

  const handleOpenCreateModal = useCallback(() => {
    if (document.activeElement instanceof HTMLElement) {
      previousFocusRef.current = document.activeElement;
    }
    setIsCreateModalOpen(true);
  }, []);

  const handleCloseCreateModal = useCallback(() => {
    setIsCreateModalOpen(false);
  }, []);

  const handleViewSale = useCallback((s: Sale) => {
    setSaleToView(s);
  }, []);

  const handleCloseViewModal = useCallback(() => {
    setSaleToView(null);
  }, []);

  const handleCreateSale = useCallback(
    (data: SaleFormData): { success: boolean; error?: string } => {
      const result = addSale(data);
      if (result.success) {
        setIsCreateModalOpen(false);
        setNotification('Продажа успешно оформлена и проведена по складу');
      }
      return result;
    },
    [addSale]
  );

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
          title="Оформить новую продажу"
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
            onClick={handleDismissNotification}
            aria-label="Закрыть уведомление"
          >
            <X size={14} />
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
      />

      {/* Table */}
      <SalesTable
        sales={paginatedSales}
        totalCount={sales.length}
        hasActiveFilters={hasActiveFilters}
        onResetFilters={handleResetFilters}
        onOpenCreateModal={handleOpenCreateModal}
        onViewSale={handleViewSale}
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

      {/* Modals */}
      {isCreateModalOpen && (
        <SaleFormModal
          isOpen={isCreateModalOpen}
          activeProducts={activeProducts}
          onClose={handleCloseCreateModal}
          onSubmit={handleCreateSale}
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
