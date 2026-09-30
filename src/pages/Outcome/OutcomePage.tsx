import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { Plus, CheckCircle2, X } from 'lucide-react';
import type {
  OutcomeFilters,
  OutcomeDocument,
  OutcomeFormData,
  OutcomeSummary,
} from '../../types';
import { useInventory } from '../../context';
import { isToday, isWithinDays } from '../../utils/dateUtils';
import { restoreFocusWithFallback } from '../../utils/focusUtils';
import {
  OutcomeStats,
  OutcomeToolbar,
  OutcomeTable,
  OutcomeFormModal,
  OutcomeViewModal,
} from '../../components/outcome';
import { Pagination } from '../../components/warehouse/Pagination/Pagination';
import styles from './OutcomePage.module.scss';

export const OutcomePage = () => {
  const { outcomeDocuments, activeProducts, addOutcomeDocument } = useInventory();

  // Filters state
  const [filters, setFilters] = useState<OutcomeFilters>({
    searchQuery: '',
    period: 'all',
    reason: 'all',
  });

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 8;

  // Modal states
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [docToView, setDocToView] = useState<OutcomeDocument | null>(null);

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
        '[data-add-outcome-btn]'
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
          '[data-add-outcome-btn]'
        );
      }
      setNotification(null);
    }, 6000);
    return () => clearTimeout(timer);
  }, [notification, isToastFocused]);

  // Dynamic statistics calculated across all outcome documents
  const stats: OutcomeSummary = useMemo(() => {
    let todayCount = 0;
    let todayUnits = 0;
    let todayCost = 0;
    let monthCount = 0;

    for (const doc of outcomeDocuments) {
      if (isToday(doc.documentDate, currentDateKey)) {
        todayCount += 1;
        todayUnits += doc.totalQuantity;
        todayCost += doc.totalCost;
      }
      if (isWithinDays(doc.documentDate, 30, currentDateKey)) {
        monthCount += 1;
      }
    }

    return {
      todayCount,
      todayUnits,
      todayCost,
      monthCount,
    };
  }, [outcomeDocuments, currentDateKey]);

  // Filter documents by search query, reason, and period
  const filteredDocuments = useMemo(() => {
    return outcomeDocuments.filter((doc) => {
      // 1. Search Query (outcomeNumber, comment, item names, item SKUs)
      if (filters.searchQuery.trim()) {
        const q = filters.searchQuery.trim().toLowerCase();
        const matchNumber = doc.outcomeNumber.toLowerCase().includes(q);
        const matchComment = doc.comment ? doc.comment.toLowerCase().includes(q) : false;
        const matchItems = doc.items.some(
          (it) =>
            it.productName.toLowerCase().includes(q) ||
            it.sku.toLowerCase().includes(q)
        );
        if (!matchNumber && !matchComment && !matchItems) {
          return false;
        }
      }

      // 2. Reason Filter
      if (filters.reason !== 'all' && doc.reason !== filters.reason) {
        return false;
      }

      // 3. Period Filter
      if (filters.period === 'today') {
        if (!isToday(doc.documentDate, currentDateKey)) return false;
      } else if (filters.period === 'week') {
        if (!isWithinDays(doc.documentDate, 7, currentDateKey)) return false;
      } else if (filters.period === 'month') {
        if (!isWithinDays(doc.documentDate, 30, currentDateKey)) return false;
      }

      return true;
    });
  }, [outcomeDocuments, filters, currentDateKey]);

  // Pagination calculation
  const totalPages = Math.ceil(filteredDocuments.length / pageSize) || 1;
  const safeCurrentPage = Math.min(currentPage, totalPages);

  const paginatedDocuments = useMemo(() => {
    const startIndex = (safeCurrentPage - 1) * pageSize;
    return filteredDocuments.slice(startIndex, startIndex + pageSize);
  }, [filteredDocuments, safeCurrentPage, pageSize]);

  const hasActiveFilters =
    Boolean(filters.searchQuery.trim()) ||
    filters.period !== 'all' ||
    filters.reason !== 'all';

  const handleResetFilters = useCallback(() => {
    setFilters({
      searchQuery: '',
      period: 'all',
      reason: 'all',
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

  const handleFilterChange = useCallback((newFilters: OutcomeFilters) => {
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

  const handleViewDocument = useCallback((doc: OutcomeDocument) => {
    setDocToView(doc);
  }, []);

  const handleCloseViewModal = useCallback(() => {
    setDocToView(null);
  }, []);

  const handleCreateOutcome = useCallback(
    (data: OutcomeFormData): { success: boolean; error?: string } => {
      const result = addOutcomeDocument(data);
      if (result.success) {
        setNotification(
          `Списание товаров успешно проведено. Остатки на складе списаны.`
        );
      }
      return result;
    },
    [addOutcomeDocument]
  );

  return (
    <div className={styles.outcomePage}>
      {/* Page Header */}
      <header className={styles.pageHeader}>
        <div className={styles.headerTitles}>
          <h1 className={styles.title}>Расход товара</h1>
          <p className={styles.subtitle}>Списание товаров со склада</p>
        </div>

        <button
          type="button"
          data-add-outcome-btn
          className={styles.addBtnHeader}
          onClick={handleOpenCreateModal}
        >
          <Plus size={16} />
          <span>Новое списание</span>
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
      <OutcomeStats summary={stats} />

      {/* Toolbar / Filters */}
      <OutcomeToolbar
        filters={filters}
        onFilterChange={handleFilterChange}
        onResetFilters={handleResetFilters}
        onOpenCreateModal={handleOpenCreateModal}
      />

      {/* Outcome Table */}
      <OutcomeTable
        documents={paginatedDocuments}
        totalCount={outcomeDocuments.length}
        hasActiveFilters={hasActiveFilters}
        onResetFilters={handleResetFilters}
        onOpenCreateModal={handleOpenCreateModal}
        onViewDocument={handleViewDocument}
      />

      {/* Pagination */}
      <Pagination
        currentPage={safeCurrentPage}
        totalPages={totalPages}
        totalItems={filteredDocuments.length}
        pageSize={pageSize}
        onPageChange={(page) => setCurrentPage(page)}
        itemLabel="актов списания"
      />

      {/* New Outcome Modal */}
      {isCreateModalOpen && (
        <OutcomeFormModal
          isOpen={isCreateModalOpen}
          activeProducts={activeProducts}
          onClose={handleCloseCreateModal}
          onSubmit={handleCreateOutcome}
        />
      )}

      {/* View Finalized Outcome Modal */}
      {docToView && (
        <OutcomeViewModal
          isOpen={Boolean(docToView)}
          document={docToView}
          onClose={handleCloseViewModal}
        />
      )}
    </div>
  );
};
