import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { Plus, AlertCircle, RotateCcw } from 'lucide-react';
import type {
  Product,
  ProductFilters,
  ProductSortConfig,
  ProductSortField,
  ProductFormData,
  WarehouseCatalogProduct,
  WarehouseRestoreResult,
} from '../../types';
import { exportProductsToCSV } from '../../utils/csvUtils';
import {
  catalogItemFromProduct,
  computeWarehouseStats,
  filterCatalogProducts,
  getEffectiveSortConfig,
  sortCatalogProducts,
  toAdminProduct,
} from '../../utils/warehouseCatalogUtils';
import { useAuth } from '../../context';
import { warehouseApi } from '../../api/warehouse';
import { WarehouseStats } from '../../components/warehouse/WarehouseStats/WarehouseStats';
import { WarehouseToolbar } from '../../components/warehouse/WarehouseToolbar/WarehouseToolbar';
import { ProductsTable } from '../../components/warehouse/ProductsTable/ProductsTable';
import { Pagination } from '../../components/warehouse/Pagination/Pagination';
import { ProductFormModal } from '../../components/warehouse/ProductFormModal/ProductFormModal';
import { AdjustStockModal } from '../../components/warehouse/AdjustStockModal/AdjustStockModal';
import { ArchiveProductModal } from '../../components/warehouse/ArchiveProductModal/ArchiveProductModal';
import { ProductMovementsModal } from '../../components/warehouse/ProductMovementsModal/ProductMovementsModal';
import { RestoreProductModal } from '../../components/warehouse/RestoreProductModal/RestoreProductModal';
import { WarehouseToast } from '../../components/warehouse/WarehouseToast/WarehouseToast';
import { useWarehouseCatalog } from './hooks/useWarehouseCatalog';
import { useProductMovements } from './hooks/useProductMovements';
import { useWarehouseArchive } from './hooks/useWarehouseArchive';
import { useWarehouseNotification } from './hooks/useWarehouseNotification';
import styles from './WarehousePage.module.scss';

const EMPTY_CATALOG: WarehouseCatalogProduct[] = [];

/**
 * Warehouse page on the role-aware RPCs rpc_list_products / rpc_list_product_movements:
 * - admin: full catalog (purchase price, warehouse value, notes and responsible persons);
 * - cashier: the server returns no purchase price / note / responsible data, so the purchase
 *   column, the «Стоимость склада» card and those movement lines are not rendered at all.
 * Mutations (create, update, adjust stock, archive) stay admin-only and go through the
 * transactional RPCs. NOTE: hiding UI is not a protection — the server role decides the data.
 * Archive view (admin only): archived products via rpc_list_archived_products, restore via
 * rpc_restore_product; the stat cards always describe the ACTIVE catalog.
 */
export const WarehousePage = () => {
  const { user, isAdmin } = useAuth();
  const userId = user?.id ?? null;

  const catalogState = useWarehouseCatalog({ userId, isAdmin });
  const { refresh: refreshCatalog, applyProduct } = catalogState;
  const catalog = catalogState.catalog;
  const serverProducts = catalog?.products ?? EMPTY_CATALOG;

  // Admin features need BOTH the client role and an admin catalog returned by the server
  const hasAdminCatalog = isAdmin && catalog?.role === 'admin';
  const showPurchasePrice = hasAdminCatalog;
  const canManage = isAdmin && (catalog === null || catalog.role === 'admin');

  const movementsResetKey = `${userId ?? ''}|${isAdmin ? 'admin' : 'staff'}`;
  const movements = useProductMovements(movementsResetKey);
  const { reloadIfOpen: reloadMovementsIfOpen } = movements;

  const { notification, notify, dismissNotification, toastRef, setIsToastFocused } =
    useWarehouseNotification(movementsResetKey);

  // A restored product returns to the active catalog (and its stat cards) immediately
  const handleRestored = useCallback(
    (result: WarehouseRestoreResult) => {
      applyProduct(result.product, 'upsert');
      refreshCatalog();
      notify(result.restored ? 'Товар восстановлен' : 'Товар уже был восстановлен');
    },
    [applyProduct, refreshCatalog, notify]
  );

  const archiveView = useWarehouseArchive({
    userId,
    isAdmin,
    accessKey: movementsResetKey,
    canUseArchive: canManage,
    onRestored: handleRestored,
  });
  const { isArchiveMode } = archiveView;

  // Data of the current view: the active catalog or the admin-only archive
  const viewState = isArchiveMode ? archiveView.archive : catalogState;
  const viewCatalog = viewState.catalog;
  const viewProducts = viewCatalog?.products ?? EMPTY_CATALOG;
  const showViewPurchasePrice = isArchiveMode ? viewCatalog?.role === 'admin' : showPurchasePrice;

  // Filters, sorting, pagination
  const [filters, setFilters] = useState<ProductFilters>({
    searchQuery: '',
    category: 'all',
    status: 'all',
  });
  const [sortConfig, setSortConfig] = useState<ProductSortConfig>({
    field: 'name',
    direction: 'asc',
  });
  const [currentPage, setCurrentPage] = useState<number>(1);
  const pageSize = 6;

  // Modal states
  const [isFormModalOpen, setIsFormModalOpen] = useState<boolean>(false);
  const [isFormSubmitting, setIsFormSubmitting] = useState<boolean>(false);
  const [productToEdit, setProductToEdit] = useState<Product | null>(null);

  const [productToAdjust, setProductToAdjust] = useState<Product | null>(null);

  const [productToArchive, setProductToArchive] = useState<Product | null>(null);
  const [isArchiveSubmitting, setIsArchiveSubmitting] = useState<boolean>(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);

  const isMountedRef = useRef<boolean>(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Close admin modals when the user changes, logs out or loses the admin role
  const [prevAccessKey, setPrevAccessKey] = useState(movementsResetKey);
  if (prevAccessKey !== movementsResetKey) {
    setPrevAccessKey(movementsResetKey);
    setIsFormModalOpen(false);
    setProductToEdit(null);
    setProductToAdjust(null);
    setProductToArchive(null);
    setArchiveError(null);
  }

  const effectiveFormModalOpen = hasAdminCatalog && isFormModalOpen;
  const effectiveProductToAdjust = hasAdminCatalog ? productToAdjust : null;
  const effectiveProductToArchive = hasAdminCatalog ? productToArchive : null;

  // Admin-only full products for the form's SKU / barcode duplicate checks
  const adminProducts = useMemo(
    () =>
      hasAdminCatalog
        ? serverProducts.map(toAdminProduct).filter((p): p is Product => p !== null)
        : [],
    [hasAdminCatalog, serverProducts]
  );

  const stats = useMemo(
    () => computeWarehouseStats(serverProducts, showPurchasePrice),
    [serverProducts, showPurchasePrice]
  );

  // Archive is a product state, not a stock status: the status filter does not apply there
  const filteredProducts = useMemo(
    () =>
      filterCatalogProducts(
        viewProducts,
        isArchiveMode ? { ...filters, status: 'all' } : filters
      ),
    [viewProducts, filters, isArchiveMode]
  );

  const effectiveSortConfig = useMemo(
    () => getEffectiveSortConfig(sortConfig, showViewPurchasePrice),
    [sortConfig, showViewPurchasePrice]
  );
  const sortedProducts = useMemo(
    () => sortCatalogProducts(filteredProducts, effectiveSortConfig),
    [filteredProducts, effectiveSortConfig]
  );

  // Pagination
  const totalPages = Math.ceil(sortedProducts.length / pageSize) || 1;
  const safeCurrentPage = Math.min(currentPage, totalPages);

  const paginatedProducts = useMemo(() => {
    const startIndex = (safeCurrentPage - 1) * pageSize;
    return sortedProducts.slice(startIndex, startIndex + pageSize);
  }, [sortedProducts, safeCurrentPage, pageSize]);

  // Movements modal shows the current catalog data of its product (e.g. after an adjustment)
  const movementsProduct = movements.product
    ? serverProducts.find((p) => p.id === movements.product?.id) ?? movements.product
    : null;

  // Handlers
  const handleSort = (field: ProductSortField) => {
    if (field === 'purchasePrice' && !showViewPurchasePrice) return;
    setSortConfig((prev) => ({
      field,
      direction: prev.field === field && prev.direction === 'asc' ? 'desc' : 'asc',
    }));
  };

  const handleResetFilters = () => {
    setFilters({
      searchQuery: '',
      category: 'all',
      status: 'all',
    });
    setCurrentPage(1);
  };

  const handleToggleArchive = () => {
    archiveView.toggleViewMode();
    setCurrentPage(1);
  };

  const handleOpenAddModal = () => {
    if (!hasAdminCatalog || isArchiveMode) return;
    setProductToEdit(null);
    setIsFormModalOpen(true);
  };

  const handleOpenEditModal = (item: WarehouseCatalogProduct) => {
    const product = hasAdminCatalog ? toAdminProduct(item) : null;
    if (!product) return;
    setProductToEdit(product);
    setIsFormModalOpen(true);
  };

  const handleOpenAdjustStockModal = (item: WarehouseCatalogProduct) => {
    const product = hasAdminCatalog ? toAdminProduct(item) : null;
    if (!product) return;
    setProductToAdjust(product);
  };

  const handleOpenArchiveModal = (item: WarehouseCatalogProduct) => {
    const product = hasAdminCatalog ? toAdminProduct(item) : null;
    if (!product) return;
    setArchiveError(null);
    setProductToArchive(product);
  };

  // Mutating handlers via Supabase RPC
  const handleFormSubmit = async (
    data: ProductFormData
  ): Promise<{
    success: boolean;
    error?: string;
    field?: 'stock' | 'purchasePrice' | 'sellingPrice' | 'sku' | 'barcode' | 'name' | 'reason';
  }> => {
    if (!hasAdminCatalog) {
      return { success: false, error: 'Недостаточно прав для выполнения операции' };
    }

    setIsFormSubmitting(true);
    try {
      if (productToEdit) {
        const res = await warehouseApi.updateProduct(productToEdit.id, {
          name: data.name,
          sku: data.sku,
          barcode: data.barcode,
          category: data.category,
          description: data.description,
          purchasePrice: data.purchasePrice,
          sellingPrice: data.sellingPrice,
          minStockThreshold: data.minStockThreshold,
        });

        if (!res.success) {
          return { success: false, error: res.error.message, field: res.error.field };
        }

        // Apply updated product immediately to avoid stale catalog
        applyProduct(catalogItemFromProduct(res.data), 'upsert');
      } else {
        const res = await warehouseApi.createProduct({
          name: data.name,
          sku: data.sku,
          barcode: data.barcode,
          category: data.category,
          description: data.description,
          purchasePrice: data.purchasePrice,
          sellingPrice: data.sellingPrice,
          stock: data.stock,
          minStockThreshold: data.minStockThreshold,
        });

        if (!res.success) {
          return { success: false, error: res.error.message, field: res.error.field };
        }

        // Apply new product immediately to list
        applyProduct(catalogItemFromProduct(res.data), 'upsert');
      }

      // Background refetch to guarantee absolute consistency with database
      refreshCatalog();
      return { success: true };
    } finally {
      if (isMountedRef.current) {
        setIsFormSubmitting(false);
      }
    }
  };

  const handleAdjustStockSubmit = async (params: {
    productId: string;
    newStock: number;
    reason: string;
  }): Promise<{ success: boolean; error?: string }> => {
    if (!hasAdminCatalog) {
      return { success: false, error: 'Недостаточно прав для выполнения операции' };
    }

    const res = await warehouseApi.adjustStock(params);
    if (!res.success) {
      return { success: false, error: res.error.message };
    }

    // Apply adjusted product immediately to catalog
    const adjusted = catalogItemFromProduct(res.data);
    applyProduct(adjusted, 'upsert');

    // Refresh products catalog in background
    refreshCatalog();

    // If movements modal happens to be open for this product, refresh movements too
    reloadMovementsIfOpen(adjusted);

    return { success: true };
  };

  const handleArchiveConfirm = async (product: Product) => {
    if (!hasAdminCatalog) return;
    setIsArchiveSubmitting(true);
    setArchiveError(null);

    try {
      const res = await warehouseApi.archiveProduct(product.id, true);
      if (!isMountedRef.current) return;

      if (!res.success) {
        setProductToArchive((current) => {
          if (current?.id === product.id) {
            setArchiveError(res.error.message);
          }
          return current;
        });
        return;
      }

      // Immediately remove archived product from active catalog view
      applyProduct(catalogItemFromProduct(res.data), 'remove');
      setProductToArchive((current) => (current?.id === product.id ? null : current));
      refreshCatalog();
    } catch {
      if (isMountedRef.current) {
        setProductToArchive((current) => {
          if (current?.id === product.id) {
            setArchiveError('Произошла ошибка при архивации товара.');
          }
          return current;
        });
      }
    } finally {
      if (isMountedRef.current) {
        setIsArchiveSubmitting(false);
      }
    }
  };

  const handleCloseFormModal = useCallback(() => {
    setIsFormModalOpen(false);
    setProductToEdit(null);
  }, []);

  const handleCloseAdjustStockModal = useCallback(() => {
    setProductToAdjust(null);
  }, []);

  const handleCloseArchiveModal = useCallback(() => {
    setProductToArchive(null);
    setArchiveError(null);
  }, []);

  // CSV contains only the columns the current role sees (no purchase price for a cashier)
  const handleExportCSV = () => {
    if (!viewCatalog) return;
    exportProductsToCSV(
      sortedProducts,
      showViewPurchasePrice,
      isArchiveMode ? 'smart-store-arkhiv.csv' : 'smart-store-sklad.csv'
    );
  };

  return (
    <div className={styles.warehousePage}>
      {/* Page Header */}
      <header className={styles.pageHeader}>
        <div className={styles.headerTitles}>
          <h1 className={styles.title}>{isArchiveMode ? 'Архив товаров' : 'Склад'}</h1>
          <p className={styles.subtitle}>
            {isArchiveMode
              ? 'Архивированные товары. Восстановите товар, чтобы вернуть его в каталог'
              : 'Управление товарами и остатками (Supabase)'}
          </p>
        </div>

        {canManage && !isArchiveMode && (
          <button
            type="button"
            data-add-product-btn
            className={styles.addBtnHeader}
            onClick={handleOpenAddModal}
            disabled={!hasAdminCatalog}
          >
            <Plus size={16} />
            <span>Добавить товар</span>
          </button>
        )}
      </header>

      {notification && (
        <WarehouseToast
          message={notification}
          toastRef={toastRef}
          onFocusChange={setIsToastFocused}
          onDismiss={dismissNotification}
        />
      )}

      {/* Network / Query Error Banner (of the current view) */}
      {viewState.error && (
        <div className={styles.errorBanner} role="alert">
          <div className={styles.errorInfo}>
            <AlertCircle size={20} />
            <span className={styles.errorText}>{viewState.error}</span>
          </div>
          <button
            type="button"
            data-retry-warehouse-catalog-btn
            className={styles.retryBtn}
            onClick={viewState.retry}
            disabled={viewState.isLoading}
          >
            <RotateCcw size={14} />
            <span>{viewState.isLoading ? 'Загрузка...' : 'Повторить'}</span>
          </button>
        </div>
      )}

      {/* Stat Cards (no warehouse value for a cashier) */}
      {catalog && (
        <WarehouseStats
          totalCount={stats.totalCount}
          totalCost={stats.totalCost}
          lowStockCount={stats.lowStockCount}
          outOfStockCount={stats.outOfStockCount}
        />
      )}

      {/* Toolbar / Filters */}
      <WarehouseToolbar
        filters={filters}
        onFilterChange={(newFilters) => {
          setFilters(newFilters);
          setCurrentPage(1);
        }}
        onResetFilters={handleResetFilters}
        onExport={handleExportCSV}
        onAddProduct={handleOpenAddModal}
        canAddProduct={hasAdminCatalog && !isArchiveMode}
        showStatusFilter={!isArchiveMode}
        archiveToggle={canManage ? { isArchiveMode, onToggle: handleToggleArchive } : undefined}
      />

      {/* Products Table or Compact Loading State; nothing partial on failure */}
      {viewState.isLoading && !viewCatalog ? (
        <div className={styles.tableLoadingCard} role="status" aria-live="polite">
          <div className={styles.spinner} aria-hidden="true" />
          <span className={styles.loadingText}>
            {isArchiveMode ? 'Загрузка архива товаров...' : 'Загрузка каталога товаров из Supabase...'}
          </span>
        </div>
      ) : viewCatalog ? (
        <ProductsTable
          products={paginatedProducts}
          sortConfig={effectiveSortConfig}
          onSort={handleSort}
          onEditProduct={handleOpenEditModal}
          onAdjustStock={handleOpenAdjustStockModal}
          onViewMovements={movements.open}
          onArchiveProduct={handleOpenArchiveModal}
          onResetFilters={handleResetFilters}
          canManageProducts={hasAdminCatalog && !isArchiveMode}
          showPurchasePrice={showViewPurchasePrice}
          variant={isArchiveMode ? 'archived' : 'active'}
          onRestoreProduct={archiveView.requestRestore}
          emptyState={
            isArchiveMode && viewProducts.length === 0
              ? { title: 'Архив пуст', subtitle: 'Архивированных товаров нет.' }
              : undefined
          }
        />
      ) : null}

      {/* Pagination */}
      {viewCatalog && (
        <Pagination
          currentPage={safeCurrentPage}
          totalPages={totalPages}
          totalItems={sortedProducts.length}
          pageSize={pageSize}
          onPageChange={(page) => setCurrentPage(page)}
        />
      )}

      {/* Add / Edit Product Modal */}
      {effectiveFormModalOpen && (
        <ProductFormModal
          key={productToEdit?.id ?? 'new-product'}
          isOpen={effectiveFormModalOpen}
          productToEdit={productToEdit}
          existingProducts={adminProducts}
          isSubmitting={isFormSubmitting}
          onClose={handleCloseFormModal}
          onSubmit={handleFormSubmit}
        />
      )}

      {/* Adjust Stock Modal */}
      {effectiveProductToAdjust && (
        <AdjustStockModal
          key={effectiveProductToAdjust.id}
          isOpen={Boolean(effectiveProductToAdjust)}
          product={effectiveProductToAdjust}
          onClose={handleCloseAdjustStockModal}
          onSubmit={handleAdjustStockSubmit}
        />
      )}

      {/* Archive Product Confirmation Modal */}
      <ArchiveProductModal
        isOpen={Boolean(effectiveProductToArchive)}
        product={effectiveProductToArchive}
        isSubmitting={isArchiveSubmitting}
        error={archiveError}
        onClose={handleCloseArchiveModal}
        onConfirm={handleArchiveConfirm}
      />

      {/* Restore Archived Product Confirmation Modal */}
      <RestoreProductModal
        isOpen={Boolean(archiveView.productToRestore)}
        product={archiveView.productToRestore}
        isSubmitting={archiveView.isRestoreSubmitting}
        error={archiveView.restoreError}
        onClose={archiveView.cancelRestore}
        onConfirm={archiveView.confirmRestore}
      />

      {/* Product Movements History Modal */}
      <ProductMovementsModal
        isOpen={Boolean(movementsProduct)}
        product={movementsProduct}
        movements={movements.movements}
        isLoading={movements.isLoading}
        error={movements.error}
        onRetry={movements.retry}
        onClose={movements.close}
      />
    </div>
  );
};
