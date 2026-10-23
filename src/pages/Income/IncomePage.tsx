import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { Plus, CheckCircle2, X, AlertCircle, RotateCcw } from 'lucide-react';
import type {
  IncomeFilters,
  IncomeReceipt,
  IncomeReceiptFormData,
  IncomeSummary,
  PendingIncomeOperation,
} from '../../types';
import { useAuth } from '../../context';
import { incomeApi } from '../../api/income';
import { restoreFocusWithFallback } from '../../utils/focusUtils';
import {
  calculateIncomeSummaryStats,
  filterIncomeReceipts,
} from '../../utils/incomeCalculations';
import {
  IncomeStats,
  IncomeToolbar,
  IncomeTable,
  IncomeFormModal,
  IncomeViewModal,
  IncomePendingBanner,
} from '../../components/income';
import { Pagination } from '../../components/warehouse/Pagination/Pagination';
import {
  getPendingIncomeOperation,
  setPendingIncomeOperation,
  clearPendingIncomeOperation,
} from '../../utils/pendingIncomeStorage';
import { useIncomeCatalog } from './hooks/useIncomeCatalog';
import styles from './IncomePage.module.scss';

/**
 * IncomePage connects to Supabase via incomeApi and useIncomeCatalog.
 * - Receipts with their lines come from the admin-only rpc_list_income_receipts (cursor pages
 *   up to 5000 receipts, all-or-nothing); recovery uses rpc_get_income_receipt.
 * - Active products come from the role-aware rpc_list_products (admin response with purchase
 *   prices, all keyset pages or nothing) via useIncomeCatalog.
 * - Receipt creations strictly execute transactional PostgreSQL RPC rpc_create_income_receipt.
 * - Accessible by administrators to record and monitor incoming stock shipments.
 */
export const IncomePage = () => {
  const { user, profile, isAdmin } = useAuth();
  const userId = user?.id ?? null;
  // Receipts are admin-only data (rpc_list_income_receipts): loaded only for an active admin
  const canLoadReceipts = Boolean(userId) && isAdmin;
  const accessKey = `${userId ?? ''}|${isAdmin ? 'admin' : 'staff'}`;
  const accessKeyRef = useRef(accessKey);
  useEffect(() => {
    accessKeyRef.current = accessKey;
  }, [accessKey]);

  // Server data states
  const [serverReceipts, setServerReceipts] = useState<IncomeReceipt[]>([]);
  const [isLoadingReceipts, setIsLoadingReceipts] = useState<boolean>(canLoadReceipts);
  const [receiptsLoadError, setReceiptsLoadError] = useState<string | null>(null);
  const [isReceiptsTruncated, setIsReceiptsTruncated] = useState<boolean>(false);

  const {
    products: serverProducts,
    isLoadingProducts,
    productsLoadError,
    loadProducts,
  } = useIncomeCatalog({ userId, isAdmin });

  // Active query cancellation references
  const receiptsAbortControllerRef = useRef<AbortController | null>(null);
  const isMountedRef = useRef<boolean>(true);

  // Filters state
  const [filters, setFilters] = useState<IncomeFilters>({
    searchQuery: '',
    period: 'all',
  });

  // Pagination state
  const [currentPage, setCurrentPage] = useState<number>(1);
  const pageSize = 8;

  // Modal states
  const [isCreateModalOpen, setIsCreateModalOpen] = useState<boolean>(false);
  const [receiptToView, setReceiptToView] = useState<IncomeReceipt | null>(null);
  const isCreateModalOpenRef = useRef<boolean>(isCreateModalOpen);
  useEffect(() => {
    isCreateModalOpenRef.current = isCreateModalOpen;
  }, [isCreateModalOpen]);

  // Notification state and focus management
  const [notification, setNotification] = useState<string | null>(null);
  const [isToastFocused, setIsToastFocused] = useState<boolean>(false);
  const toastRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  // Unconfirmed pending operation state preserved outside modal, scoped by userId
  const [pendingOperation, setPendingOperation] = useState<PendingIncomeOperation | null>(() =>
    getPendingIncomeOperation(userId)
  );
  const [isResolvingPending, setIsResolvingPending] = useState<boolean>(false);
  const userIdRef = useRef(userId);
  useEffect(() => {
    userIdRef.current = userId;
  }, [userId]);

  // Reset state on user switch or logout
  const [prevUserId, setPrevUserId] = useState<string | null>(userId);
  if (prevUserId !== userId) {
    setPrevUserId(userId);
    setServerReceipts([]);
    setIsLoadingReceipts(canLoadReceipts);
    setReceiptsLoadError(null);
    setIsReceiptsTruncated(false);
    setIsCreateModalOpen(false);
    setReceiptToView(null);
    setNotification(null);
    setPendingOperation(getPendingIncomeOperation(userId));
    setIsResolvingPending(false);
  }

  // Role change of the same user: close the create modal and never keep receipts loaded under
  // the previous role (the load effect aborts the in-flight request and reloads for an admin)
  const [prevIsAdmin, setPrevIsAdmin] = useState<boolean>(isAdmin);
  if (prevIsAdmin !== isAdmin) {
    setPrevIsAdmin(isAdmin);
    if (!isAdmin && isCreateModalOpen) {
      setIsCreateModalOpen(false);
    }
    setServerReceipts([]);
    setIsLoadingReceipts(canLoadReceipts);
    setReceiptsLoadError(null);
    setIsReceiptsTruncated(false);
    setReceiptToView(null);
  }

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

  // Load income receipts from Supabase
  const loadReceipts = useCallback(async () => {
    if (!userId || !canLoadReceipts) return;
    const requestAccessKey = `${userId}|admin`;

    if (receiptsAbortControllerRef.current) {
      receiptsAbortControllerRef.current.abort();
    }
    const controller = new AbortController();
    receiptsAbortControllerRef.current = controller;

    setIsLoadingReceipts(true);
    setReceiptsLoadError(null);

    try {
      const res = await incomeApi.fetchIncomeReceipts(controller.signal);
      if (
        !isMountedRef.current ||
        controller.signal.aborted ||
        receiptsAbortControllerRef.current !== controller ||
        accessKeyRef.current !== requestAccessKey
      ) {
        return;
      }

      if (res.success) {
        setServerReceipts(res.data.receipts);
        setIsReceiptsTruncated(res.data.isTruncated);

        // If a pending operation was committed on server, clear it and notify user
        const currentPending = getPendingIncomeOperation(userId);
        if (currentPending) {
          const found = res.data.receipts.some((r) => r.id === currentPending.id);
          if (found) {
            clearPendingIncomeOperation(userId, currentPending.id);
            setPendingOperation((prev) => (prev?.id === currentPending.id ? null : prev));
            setNotification(
              `Накладная от «${currentPending.payload.supplier}» успешно проведена и подтверждена на сервере.`
            );
            if (!isCreateModalOpenRef.current) {
              restoreFocusWithFallback(null, '[data-add-income-btn]');
            }
          }
        }
      } else {
        setReceiptsLoadError(res.error.message);
      }
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return;
      }
      if (
        !isMountedRef.current ||
        controller.signal.aborted ||
        receiptsAbortControllerRef.current !== controller
      ) {
        return;
      }
      setReceiptsLoadError(
        'Не удалось загрузить приходные накладные. Проверьте подключение к сети.'
      );
    } finally {
      if (
        isMountedRef.current &&
        receiptsAbortControllerRef.current === controller
      ) {
        setIsLoadingReceipts(false);
      }
    }
  }, [userId, canLoadReceipts]);

  // Lifecycle & data loading; a user OR role change aborts the request and reloads
  useEffect(() => {
    isMountedRef.current = true;
    if (!canLoadReceipts) return;

    void Promise.resolve().then(() => {
      if (isMountedRef.current) {
        loadReceipts();
      }
    });

    return () => {
      isMountedRef.current = false;
      if (receiptsAbortControllerRef.current) {
        receiptsAbortControllerRef.current.abort();
      }
    };
  }, [userId, canLoadReceipts, loadReceipts]);

  // Dynamic statistics calculated across all server income receipts
  const stats: IncomeSummary = useMemo(() => {
    return calculateIncomeSummaryStats(serverReceipts, currentDateKey);
  }, [serverReceipts, currentDateKey]);

  // Filter receipts by search query and period
  const filteredReceipts = useMemo(() => {
    return filterIncomeReceipts(serverReceipts, filters, currentDateKey);
  }, [serverReceipts, filters, currentDateKey]);

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

  const isCreateDisabled =
    isLoadingProducts || Boolean(productsLoadError) || isLoadingReceipts;
  const createDisabledTooltip = productsLoadError
    ? 'Не удалось загрузить каталог товаров'
    : isLoadingProducts
      ? 'Загрузка каталога товаров...'
      : isLoadingReceipts
        ? 'Загрузка данных прихода...'
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

  const handleViewReceipt = useCallback((receipt: IncomeReceipt) => {
    setReceiptToView(receipt);
  }, []);

  const handleCloseViewModal = useCallback(() => {
    setReceiptToView(null);
  }, []);

  const handleResolvePending = useCallback(async () => {
    if (!pendingOperation || !userId || isResolvingPending) return;
    const targetOp = pendingOperation;
    const targetOpId = targetOp.id;
    const activeUserId = userId;
    const wasFocusOnResolveBtn = Boolean(
      document.activeElement?.closest('[data-resolve-pending-btn]')
    );

    setIsResolvingPending(true);
    setIsLoadingReceipts(true);
    let shouldRestoreFocus = false;

    try {
      const checkRes = await incomeApi.fetchIncomeReceiptById(targetOpId);
      if (!isMountedRef.current || userIdRef.current !== activeUserId) return;

      if (checkRes.success) {
        if (checkRes.data) {
          clearPendingIncomeOperation(activeUserId, targetOpId);
          setPendingOperation((prev) => (prev?.id === targetOpId ? null : prev));
          await Promise.all([loadReceipts(), loadProducts()]);
          setNotification(
            `Накладная № ${checkRes.data.receiptNumber} от «${checkRes.data.supplier}» успешно проведена на сервере.`
          );
          shouldRestoreFocus = true;
        } else {
          // P0 #2: Absence of row does NOT confirm transaction aborted.
          // Retry the RPC using the SAME UUID to safely conclude or commit:
          const retryRes = await incomeApi.createIncomeReceipt({
            ...targetOp.payload,
            id: targetOpId,
          });

          if (!isMountedRef.current || userIdRef.current !== activeUserId) return;

          if (retryRes.success) {
            clearPendingIncomeOperation(activeUserId, targetOpId);
            setPendingOperation((prev) => (prev?.id === targetOpId ? null : prev));
            await Promise.all([loadReceipts(), loadProducts()]);
            setNotification(
              `Накладная от «${targetOp.payload.supplier}» успешно проведена на сервере.`
            );
            shouldRestoreFocus = true;
          } else if (!retryRes.error.isNetworkError && !retryRes.error.isAuthError) {
            // Confirmed server refusal: transaction aborted, safe to clear
            clearPendingIncomeOperation(activeUserId, targetOpId);
            setPendingOperation((prev) => (prev?.id === targetOpId ? null : prev));
            setNotification(
              `Сервер отклонил накладную: ${retryRes.error.message}. Теперь можно оформить приход заново.`
            );
            shouldRestoreFocus = true;
          } else if (retryRes.error.isAuthError) {
            setNotification(
              `${retryRes.error.message} Неподтверждённая накладная сохранена для повторной проверки.`
            );
          } else {
            setNotification('Связь с сервером ещё не восстановлена. Проверьте подключение к сети.');
          }
        }
      } else {
        setNotification('Связь с сервером ещё не восстановлена. Проверьте интернет-соединение.');
      }
    } finally {
      if (isMountedRef.current && userIdRef.current === activeUserId) {
        setIsLoadingReceipts(false);
        setIsResolvingPending(false);
      }
      requestAnimationFrame(() => {
        if (!isMountedRef.current || isCreateModalOpenRef.current) return;

        if (shouldRestoreFocus) {
          restoreFocusWithFallback(null, '[data-add-income-btn]');
        } else if (
          wasFocusOnResolveBtn ||
          document.activeElement === document.body ||
          !document.activeElement
        ) {
          const resolveBtn = document.querySelector<HTMLElement>(
            '[data-resolve-pending-btn]:not(:disabled)'
          );
          resolveBtn?.focus();
        }
      });
    }
  }, [pendingOperation, userId, isResolvingPending, loadReceipts, loadProducts]);

  const handleCreateReceipt = useCallback(
    async (
      data: IncomeReceiptFormData & { id?: string }
    ): Promise<{
      success: boolean;
      error?: string;
      isNetworkError?: boolean;
      isAuthError?: boolean;
    }> => {
      const { id: inputId, ...purePayload } = data;
      const activeUserId = userId;
      const opId =
        inputId ||
        pendingOperation?.id ||
        (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `inc-${Date.now()}`);

      // P0: Persist pending operation BEFORE calling RPC!
      if (activeUserId) {
        const op: PendingIncomeOperation = {
          id: opId,
          userId: activeUserId,
          payload: purePayload,
          submittedAt: new Date().toISOString(),
        };
        const persisted = setPendingIncomeOperation(op);
        if (!persisted) {
          return {
            success: false,
            error:
              'Не удалось зафиксировать сессию операции перед проведением. Проверьте настройки хранилища браузера.',
          };
        }
        setPendingOperation(op);
      }

      const res = await incomeApi.createIncomeReceipt({
        ...purePayload,
        id: opId,
      });

      if (res.success) {
        if (activeUserId) {
          clearPendingIncomeOperation(activeUserId, opId);
        }
        if (!isMountedRef.current || userIdRef.current !== activeUserId) {
          return { success: true };
        }
        setPendingOperation((prev) => (prev?.id === opId ? null : prev));
        setNotification(
          `Накладная от «${purePayload.supplier}» успешно проведена. Остатки товаров на складе обновлены.`
        );
        // Refetch fresh receipts and updated product catalog stocks from Supabase
        await Promise.all([loadReceipts(), loadProducts()]);
        return { success: true };
      }

      if (!res.error.isNetworkError && !res.error.isAuthError) {
        // Confirmed server refusal (transaction aborted): safe to clear pending operation
        if (activeUserId) {
          clearPendingIncomeOperation(activeUserId, opId);
        }
        if (isMountedRef.current && userIdRef.current === activeUserId) {
          setPendingOperation((prev) => (prev?.id === opId ? null : prev));
        }
      }
      // If network error or auth error: pendingOperation stays in storage and state!

      return {
        success: false,
        error: res.error.message,
        isNetworkError: res.error.isNetworkError,
        isAuthError: res.error.isAuthError,
      };
    },
    [pendingOperation, userId, loadReceipts, loadProducts]
  );

  return (
    <div className={styles.incomePage}>
      {/* Page Header */}
      <header className={styles.pageHeader}>
        <div className={styles.headerTitles}>
          <h1 className={styles.title}>Приход</h1>
          <p className={styles.subtitle}>Поступление товаров на склад</p>
        </div>

        {isAdmin && (
          <button
            type="button"
            data-add-income-btn
            className={styles.addBtnHeader}
            onClick={handleOpenCreateModal}
            disabled={isCreateDisabled}
            title={createDisabledTooltip ?? 'Оформить новое поступление товара'}
          >
            <Plus size={16} />
            <span>Новый приход</span>
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
            onClick={handleDismissNotification}
            aria-label="Закрыть уведомление"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Products Loading Error Banner */}
      {productsLoadError && (
        <div className={styles.errorBanner} role="alert">
          <div className={styles.errorInfo}>
            <AlertCircle size={20} />
            <span className={styles.errorText}>{productsLoadError}</span>
          </div>
          <button
            type="button"
            className={styles.retryBtn}
            onClick={() => {
              restoreFocusWithFallback(null, '[data-add-income-btn]');
              void loadProducts();
            }}
          >
            <RotateCcw size={14} />
            <span>Повторить</span>
          </button>
        </div>
      )}

      {/* Pending Unconfirmed Operation Banner */}
      <IncomePendingBanner
        pendingOperation={pendingOperation}
        isResolving={isResolvingPending}
        isLoading={isLoadingReceipts}
        onResolve={handleResolvePending}
      />

      {/* Dynamic Stat Cards */}
      <IncomeStats summary={stats} />

      {/* Toolbar / Filters */}
      <IncomeToolbar
        filters={filters}
        onFilterChange={handleFilterChange}
        onResetFilters={handleResetFilters}
        onOpenCreateModal={handleOpenCreateModal}
        canCreate={isAdmin}
        isCreateDisabled={isCreateDisabled}
        createDisabledTooltip={createDisabledTooltip}
      />

      {/* Main Table Area with Loading / Error / Data States */}
      {isLoadingReceipts ? (
        <div className={styles.tableLoadingCard}>
          <div className={styles.spinner} />
          <p className={styles.loadingText}>Загрузка приходных накладных...</p>
        </div>
      ) : receiptsLoadError ? (
        <div className={styles.errorBanner} role="alert">
          <div className={styles.errorInfo}>
            <AlertCircle size={20} />
            <span className={styles.errorText}>{receiptsLoadError}</span>
          </div>
          <button
            type="button"
            className={styles.retryBtn}
            onClick={() => {
              restoreFocusWithFallback(null, '[data-add-income-btn]');
              void loadReceipts();
            }}
          >
            <RotateCcw size={14} />
            <span>Повторить</span>
          </button>
        </div>
      ) : (
        <>
          {isReceiptsTruncated && (
            <div className={styles.truncatedNotice} role="status">
              <AlertCircle size={16} />
              <span>
                В целях производительности загружены последние 5 000 накладных. Поиск, фильтры и статистика рассчитываются по этим документам.
              </span>
            </div>
          )}
          <IncomeTable
            receipts={paginatedReceipts}
            totalReceiptsCount={serverReceipts.length}
            hasActiveFilters={hasActiveFilters}
            onResetFilters={handleResetFilters}
            onOpenCreateModal={handleOpenCreateModal}
            onViewReceipt={handleViewReceipt}
            canCreate={isAdmin}
            isCreateDisabled={isCreateDisabled}
            createDisabledTooltip={createDisabledTooltip}
          />
        </>
      )}

      {/* Pagination */}
      {!isLoadingReceipts && !receiptsLoadError && filteredReceipts.length > 0 && (
        <Pagination
          currentPage={safeCurrentPage}
          totalPages={totalPages}
          totalItems={filteredReceipts.length}
          pageSize={pageSize}
          onPageChange={(page) => setCurrentPage(page)}
          itemLabel="накладных"
        />
      )}

      {/* New Income Receipt Modal */}
      {isCreateModalOpen && isAdmin && (
        <IncomeFormModal
          isOpen={isCreateModalOpen}
          activeProducts={serverProducts}
          initialResponsiblePerson={profile?.full_name || 'Администратор'}
          pendingOperation={pendingOperation}
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
