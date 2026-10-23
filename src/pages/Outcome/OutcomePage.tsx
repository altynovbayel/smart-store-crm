import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { Navigate } from 'react-router-dom';
import { Plus, CheckCircle2, X, AlertCircle, RotateCcw } from 'lucide-react';
import type {
  OutcomeFilters,
  OutcomeDocument,
  OutcomeSummary,
} from '../../types';
import { OUTCOME_REASONS } from '../../types';
import { useAuth } from '../../context';
import {
  calculateOutcomeSummaryStats,
  filterOutcomeDocuments,
} from '../../utils/outcomeCalculations';
import {
  OutcomeStats,
  OutcomeToolbar,
  OutcomeTable,
  OutcomeFormModal,
  OutcomeViewModal,
  OutcomePendingBanner,
} from '../../components/outcome';
import { Pagination } from '../../components/warehouse/Pagination/Pagination';
import { useCurrentDateKey } from './hooks/useCurrentDateKey';
import { useOutcomeNotification } from './hooks/useOutcomeNotification';
import { usePendingOutcome } from './hooks/usePendingOutcome';
import { useOutcomeData } from './hooks/useOutcomeData';
import { useOutcomeSubmission } from './hooks/useOutcomeSubmission';
import styles from './OutcomePage.module.scss';

const DEFAULT_FILTERS: OutcomeFilters = {
  searchQuery: '',
  period: 'all',
  reason: 'all',
};

const PAGE_SIZE = 8;

/**
 * OutcomePage connects to Supabase via outcomeApi and useOutcomeData.
 * - Outcome documents and line items are loaded from public.outcome_documents and public.outcome_items.
 * - Active products come from the role-aware rpc_list_products (admin response with purchase
 *   prices, all keyset pages or nothing).
 * - Write-off operations strictly execute transactional PostgreSQL RPC rpc_create_outcome_document.
 * - Accessible strictly by active administrators (route guard + in-page isAdmin redirect).
 */
export const OutcomePage = () => {
  const { user, profile, isAdmin } = useAuth();
  const userId = user?.id ?? null;

  // Filters & pagination state
  const [filters, setFilters] = useState<OutcomeFilters>(DEFAULT_FILTERS);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const pageSize = PAGE_SIZE;

  // Modal states
  const [isCreateModalOpen, setIsCreateModalOpen] = useState<boolean>(false);
  const [docToView, setDocToView] = useState<OutcomeDocument | null>(null);
  const isCreateModalOpenRef = useRef<boolean>(isCreateModalOpen);
  const docToViewRef = useRef<OutcomeDocument | null>(docToView);
  useEffect(() => {
    isCreateModalOpenRef.current = isCreateModalOpen;
  }, [isCreateModalOpen]);
  useEffect(() => {
    docToViewRef.current = docToView;
  }, [docToView]);

  const isAnyModalOpen = useCallback(
    () => isCreateModalOpenRef.current || Boolean(docToViewRef.current),
    []
  );

  // Close modals on user switch or logout
  const [prevUserId, setPrevUserId] = useState<string | null>(userId);
  if (prevUserId !== userId) {
    setPrevUserId(userId);
    setIsCreateModalOpen(false);
    setDocToView(null);
  }

  // Close create modal immediately if admin privileges are lost
  const [prevIsAdmin, setPrevIsAdmin] = useState<boolean>(isAdmin);
  if (prevIsAdmin !== isAdmin) {
    setPrevIsAdmin(isAdmin);
    if (!isAdmin && isCreateModalOpen) {
      setIsCreateModalOpen(false);
    }
  }

  const currentDateKey = useCurrentDateKey();

  const previousFocusRef = useRef<HTMLElement | null>(null);
  const { notification, notify, dismissNotification, toastRef, setIsToastFocused } =
    useOutcomeNotification(userId, previousFocusRef);

  const { pendingOperation, persistPending, clearPending, confirmPendingFromDocuments } =
    usePendingOutcome(userId);

  // If the pending operation is found among loaded documents, it was committed on the server
  const handleDocumentsLoaded = useCallback(
    (loadedDocuments: OutcomeDocument[]): boolean => {
      const confirmed = confirmPendingFromDocuments(loadedDocuments);
      if (!confirmed) return false;
      const reasonLabel = OUTCOME_REASONS[confirmed.payload.reason] || confirmed.payload.reason;
      notify(`Документ списания («${reasonLabel}») успешно проведён и подтверждён на сервере.`);
      return true;
    },
    [confirmPendingFromDocuments, notify]
  );

  const {
    documents: serverDocuments,
    isLoadingDocuments: isFetchingDocuments,
    documentsLoadError,
    isDocumentsTruncated,
    products: serverProducts,
    isLoadingProducts,
    productsLoadError,
    loadDocuments,
    loadProducts,
    reloadAll,
  } = useOutcomeData({
    userId,
    isAdmin,
    isAnyModalOpen,
    onDocumentsLoaded: handleDocumentsLoaded,
  });

  const { isResolvingPending, handleResolvePending, handleCreateOutcome } = useOutcomeSubmission({
    userId,
    pendingOperation,
    persistPending,
    clearPending,
    reloadAll,
    refreshProducts: loadProducts,
    notify,
    isAnyModalOpen,
  });

  // Resolving a pending operation counts as document loading (disables creation and retry)
  const isLoadingDocuments = isFetchingDocuments || isResolvingPending;

  // Dynamic statistics calculated across all server outcome documents
  const stats: OutcomeSummary = useMemo(() => {
    return calculateOutcomeSummaryStats(serverDocuments, currentDateKey);
  }, [serverDocuments, currentDateKey]);

  // Filter documents by search query, reason, and period
  const filteredDocuments = useMemo(() => {
    return filterOutcomeDocuments(serverDocuments, filters, currentDateKey);
  }, [serverDocuments, filters, currentDateKey]);

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
    setFilters(DEFAULT_FILTERS);
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

  const isCreateDisabled =
    isLoadingProducts || Boolean(productsLoadError) || isLoadingDocuments;
  const createDisabledTooltip = productsLoadError
    ? 'Не удалось загрузить каталог товаров'
    : isLoadingProducts
      ? 'Загрузка каталога товаров...'
      : isLoadingDocuments
        ? 'Загрузка данных списания...'
        : undefined;

  const handleOpenCreateModal = useCallback(() => {
    if (!isAdmin || isCreateDisabled) return;
    if (document.activeElement instanceof HTMLElement) {
      previousFocusRef.current = document.activeElement;
    }
    setIsCreateModalOpen(true);
  }, [isAdmin, isCreateDisabled]);

  const handleCloseCreateModal = useCallback(() => {
    setIsCreateModalOpen(false);
  }, []);

  const handleViewDocument = useCallback((doc: OutcomeDocument) => {
    setDocToView(doc);
  }, []);

  const handleCloseViewModal = useCallback(() => {
    setDocToView(null);
  }, []);

  if (!isAdmin) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className={styles.outcomePage}>
      {/* Page Header */}
      <header className={styles.pageHeader}>
        <div className={styles.headerTitles}>
          <h1 className={styles.title}>Расход товара</h1>
          <p className={styles.subtitle}>Списание товаров со склада</p>
        </div>

        {isAdmin && (
          <button
            type="button"
            data-add-outcome-btn
            className={styles.addBtnHeader}
            onClick={handleOpenCreateModal}
            disabled={isCreateDisabled}
            title={createDisabledTooltip ?? 'Оформить новое списание товара'}
          >
            <Plus size={16} />
            <span>Новое списание</span>
          </button>
        )}
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
            onClick={dismissNotification}
            aria-label="Закрыть уведомление"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Pending Unconfirmed Operation Banner */}
      <OutcomePendingBanner
        pendingOperation={pendingOperation}
        isResolving={isResolvingPending}
        isLoading={isLoadingDocuments}
        onResolve={handleResolvePending}
      />

      {/* Truncated documents notice */}
      {isDocumentsTruncated && (
        <div className={styles.truncatedNotice} role="note">
          <AlertCircle size={16} aria-hidden="true" />
          <span>
            Показаны последние {serverDocuments.length} актов списания (достигнут лимит выборки).
          </span>
        </div>

      )}

      {/* Error Banners with Retry */}
      {documentsLoadError && (
        <div className={styles.errorBanner} role="alert">
          <div className={styles.errorInfo}>
            <AlertCircle size={20} />
            <span className={styles.errorText}>{documentsLoadError}</span>
          </div>
          <button
            type="button"
            data-retry-documents-btn
            className={styles.retryBtn}
            onClick={() => void loadDocuments(true)}
            disabled={isLoadingDocuments}
          >
            <RotateCcw size={14} />
            <span>{isLoadingDocuments ? 'Загрузка...' : 'Повторить'}</span>
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

      {/* 4 Dynamic Stat Cards */}
      <OutcomeStats summary={stats} />

      {/* Toolbar / Filters */}
      <OutcomeToolbar
        filters={filters}
        onFilterChange={handleFilterChange}
        onResetFilters={handleResetFilters}
        onOpenCreateModal={handleOpenCreateModal}
        canCreate={isAdmin}
        isCreateDisabled={isCreateDisabled}
        createDisabledTooltip={createDisabledTooltip}
      />

      {/* Outcome Table with Loading State */}
      {isLoadingDocuments && serverDocuments.length === 0 ? (
        <div className={styles.tableLoadingCard}>
          <div
            className={styles.spinner}
            role="progressbar"
            aria-label="Загрузка документов списания"
          />
          <span className={styles.loadingText}>Загрузка документов списания...</span>
        </div>
      ) : (
        <>
          <OutcomeTable
            documents={paginatedDocuments}
            totalCount={serverDocuments.length}
            hasActiveFilters={hasActiveFilters}
            onResetFilters={handleResetFilters}
            onOpenCreateModal={handleOpenCreateModal}
            onViewDocument={handleViewDocument}
            canCreate={isAdmin}
            isCreateDisabled={isCreateDisabled}
            createDisabledTooltip={createDisabledTooltip}
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
        </>
      )}

      {/* New Outcome Modal */}
      {isCreateModalOpen && isAdmin && (
        <OutcomeFormModal
          isOpen={isCreateModalOpen}
          activeProducts={serverProducts}
          initialResponsiblePerson={profile?.full_name || 'Администратор'}
          pendingOperation={pendingOperation}
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
