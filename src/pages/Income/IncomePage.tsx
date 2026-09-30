import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { Plus, CheckCircle2, X } from 'lucide-react';
import type {
  IncomeFilters,
  IncomeReceipt,
  IncomeReceiptFormData,
  IncomeSummary,
} from '../../types';
import { useInventory } from '../../context';
import { isToday, isWithinDays } from '../../utils/dateUtils';
import { restoreFocusWithFallback } from '../../utils/focusUtils';
import {
  IncomeStats,
  IncomeToolbar,
  IncomeTable,
  IncomeFormModal,
  IncomeViewModal,
} from '../../components/income';
import { Pagination } from '../../components/warehouse/Pagination/Pagination';
import styles from './IncomePage.module.scss';

export const IncomePage = () => {
  const { incomeReceipts, activeProducts, addIncomeReceipt } = useInventory();

  // Filters state
  const [filters, setFilters] = useState<IncomeFilters>({
    searchQuery: '',
    period: 'all',
  });

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 8;

  // Modal states
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [receiptToView, setReceiptToView] = useState<IncomeReceipt | null>(null);

  // Notification state and focus management
  const [notification, setNotification] = useState<string | null>(null);
  const [isToastFocused, setIsToastFocused] = useState(false);
  const toastRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  // Keep track of current calendar date (YYYY-MM-DD) to refresh date-dependent calculations across midnight/tab focus
  const [currentDateKey, setCurrentDateKey] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
  });

  useEffect(() => {
    const updateDate = () => {
      const now = new Date();
      const newKey = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
      setCurrentDateKey((prev) => (prev !== newKey ? newKey : prev));
    };

    // 1. Refresh on tab focus and visibility change
    const handleFocus = () => updateDate();
    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleFocus);

    // 2. Periodic interval (every 30s) to catch midnight transition smoothly
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
        '[data-add-income-btn]'
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
          '[data-add-income-btn]'
        );
      }
      setNotification(null);
    }, 6000);
    return () => clearTimeout(timer);
  }, [notification, isToastFocused]);

  // Dynamic statistics calculated across all income receipts
  const stats: IncomeSummary = useMemo(() => {
    let todayCount = 0;
    let todayUnits = 0;
    let todayAmount = 0;
    const suppliers = new Set<string>();

    for (const receipt of incomeReceipts) {
      if (receipt.supplier.trim()) {
        suppliers.add(receipt.supplier.trim().toLowerCase());
      }
      if (isToday(receipt.receivedAt, currentDateKey)) {
        todayCount += 1;
        todayUnits += receipt.totalQuantity;
        todayAmount += receipt.totalAmount;
      }
    }

    return {
      todayCount,
      todayUnits,
      todayAmount,
      suppliersCount: suppliers.size,
    };
  }, [incomeReceipts, currentDateKey]);

  // Filter receipts by search query and period
  const filteredReceipts = useMemo(() => {
    return incomeReceipts.filter((receipt) => {
      // 1. Search Query
      if (filters.searchQuery.trim()) {
        const q = filters.searchQuery.trim().toLowerCase();
        const matchNumber = receipt.receiptNumber.toLowerCase().includes(q);
        const matchSupplier = receipt.supplier.toLowerCase().includes(q);
        const matchDoc = receipt.documentNumber.toLowerCase().includes(q);
        if (!matchNumber && !matchSupplier && !matchDoc) {
          return false;
        }
      }

      // 2. Period Filter
      if (filters.period === 'today') {
        if (!isToday(receipt.receivedAt, currentDateKey)) return false;
      } else if (filters.period === 'week') {
        if (!isWithinDays(receipt.receivedAt, 7, currentDateKey)) return false;
      } else if (filters.period === 'month') {
        if (!isWithinDays(receipt.receivedAt, 30, currentDateKey)) return false;
      }

      return true;
    });
  }, [incomeReceipts, filters, currentDateKey]);

  // Pagination calculation
  const totalPages = Math.ceil(filteredReceipts.length / pageSize) || 1;
  const safeCurrentPage = Math.min(currentPage, totalPages);

  const paginatedReceipts = useMemo(() => {
    const startIndex = (safeCurrentPage - 1) * pageSize;
    return filteredReceipts.slice(startIndex, startIndex + pageSize);
  }, [filteredReceipts, safeCurrentPage, pageSize]);

  const hasActiveFilters =
    Boolean(filters.searchQuery.trim()) || filters.period !== 'all';

  const handleResetFilters = useCallback(() => {
    setFilters({
      searchQuery: '',
      period: 'all',
    });
    setCurrentPage(1);
    requestAnimationFrame(() => {
      const searchInput = document.querySelector<HTMLInputElement>(
        'input[type="search"]'
      );
      if (searchInput && document.contains(searchInput)) {
        searchInput.focus();
      }
    });
  }, []);

  const handleFilterChange = useCallback((newFilters: IncomeFilters) => {
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

  const handleViewReceipt = useCallback((receipt: IncomeReceipt) => {
    setReceiptToView(receipt);
  }, []);

  const handleCloseViewModal = useCallback(() => {
    setReceiptToView(null);
  }, []);

  const handleCreateReceipt = useCallback(
    (data: IncomeReceiptFormData): { success: boolean; error?: string } => {
      const result = addIncomeReceipt(data);
      if (result.success) {
        setNotification(
          `Накладная от «${data.supplier}» успешно проведена. Остатки товаров на складе обновлены.`
        );
      }
      return result;
    },
    [addIncomeReceipt]
  );

  return (
    <div className={styles.incomePage}>
      {/* Page Header */}
      <header className={styles.pageHeader}>
        <div className={styles.headerTitles}>
          <h1 className={styles.title}>Приход</h1>
          <p className={styles.subtitle}>Поступление товаров на склад</p>
        </div>

        <button
          type="button"
          data-add-income-btn
          className={styles.addBtnHeader}
          onClick={handleOpenCreateModal}
        >
          <Plus size={16} />
          <span>Новый приход</span>
        </button>
      </header>

      {/* Notification Toast */}
      {notification && (
        <div
          ref={toastRef}
          className={styles.toast}
          role="status"
          onFocus={() => setIsToastFocused(true)}
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget)) {
              setIsToastFocused(false);
            }
          }}
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

      {/* 4 Dynamic Stat Cards */}
      <IncomeStats summary={stats} />

      {/* Toolbar / Filters */}
      <IncomeToolbar
        filters={filters}
        onFilterChange={handleFilterChange}
        onResetFilters={handleResetFilters}
        onOpenCreateModal={handleOpenCreateModal}
      />

      {/* Income Receipts Table */}
      <IncomeTable
        receipts={paginatedReceipts}
        totalReceiptsCount={incomeReceipts.length}
        hasActiveFilters={hasActiveFilters}
        onResetFilters={handleResetFilters}
        onOpenCreateModal={handleOpenCreateModal}
        onViewReceipt={handleViewReceipt}
      />

      {/* Pagination */}
      <Pagination
        currentPage={safeCurrentPage}
        totalPages={totalPages}
        totalItems={filteredReceipts.length}
        pageSize={pageSize}
        onPageChange={(page) => setCurrentPage(page)}
        itemLabel="накладных"
      />

      {/* New Income Receipt Modal */}
      {isCreateModalOpen && (
        <IncomeFormModal
          isOpen={isCreateModalOpen}
          activeProducts={activeProducts}
          onClose={handleCloseCreateModal}
          onSubmit={handleCreateReceipt}
        />
      )}

      {/* View Finalized Income Receipt Modal */}
      {receiptToView && (
        <IncomeViewModal
          isOpen={Boolean(receiptToView)}
          receipt={receiptToView}
          onClose={handleCloseViewModal}
        />
      )}
    </div>
  );
};
