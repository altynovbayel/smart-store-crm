import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Plus, AlertCircle, RotateCcw } from 'lucide-react';
import type {
  Product,
  ProductFilters,
  ProductSortConfig,
  ProductSortField,
  ProductFormData,
  WarehouseMovement,
} from '../../types';
import { exportProductsToCSV } from '../../utils/csvUtils';
import { restoreFocusWithFallback } from '../../utils/focusUtils';
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
import styles from './WarehousePage.module.scss';

/**
 * NOTE: WarehousePage is now connected directly to Supabase via warehouseApi.
 * Products and Stock Movements are loaded from real database tables (public.products,
 * public.stock_movements). All mutations (create, update, adjust stock, archive)
 * strictly go through transactional PostgreSQL RPC functions (rpc_create_product,
 * rpc_update_product, rpc_adjust_product_stock, rpc_archive_product).
 * Other modules (Income, Outcome, Sales, Dashboard, Reports) remain locally powered
 * by InventoryProvider pending their respective integration stages.
 */
export const WarehousePage = () => {
  const { user, isAdmin } = useAuth();

  // Server data state
  const [serverProducts, setServerProducts] = useState<Product[]>([]);
  const [isLoadingProducts, setIsLoadingProducts] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);

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

  const [productForMovements, setProductForMovements] = useState<Product | null>(null);
  const [movementsList, setMovementsList] = useState<WarehouseMovement[]>([]);
  const [isLoadingMovements, setIsLoadingMovements] = useState<boolean>(false);
  const [movementsError, setMovementsError] = useState<string | null>(null);

  // Active query cancellation references
  const productsAbortControllerRef = useRef<AbortController | null>(null);
  const movementsAbortControllerRef = useRef<AbortController | null>(null);
  const isMountedRef = useRef<boolean>(true);

  // Reset state when user changes or logs out
  const [prevUserId, setPrevUserId] = useState<string | null>(user?.id ?? null);
  if (prevUserId !== (user?.id ?? null)) {
    setPrevUserId(user?.id ?? null);
    setServerProducts([]);
    setIsLoadingProducts(Boolean(user));
    setLoadError(null);
    setIsFormModalOpen(false);
    setProductToEdit(null);
    setProductToAdjust(null);
    setProductToArchive(null);
    setArchiveError(null);
    setProductForMovements(null);
    setMovementsList([]);
    setMovementsError(null);
  }

  // Reset admin-only modal states immediately when isAdmin permission is lost
  const [prevIsAdmin, setPrevIsAdmin] = useState<boolean>(isAdmin);
  if (prevIsAdmin !== isAdmin) {
    setPrevIsAdmin(isAdmin);
    if (!isAdmin) {
      if (isFormModalOpen) {
        setIsFormModalOpen(false);
        setProductToEdit(null);
      }
      if (productToAdjust) {
        setProductToAdjust(null);
      }
      if (productToArchive) {
        setProductToArchive(null);
        setArchiveError(null);
      }
    }
  }

  const effectiveFormModalOpen = isAdmin && isFormModalOpen;
  const effectiveProductToAdjust = isAdmin ? productToAdjust : null;
  const effectiveProductToArchive = isAdmin ? productToArchive : null;

  const userId = user?.id ?? null;

  // 1. Fetch products from Supabase
  const loadProducts = useCallback(async () => {
    if (!userId) return;
    if (productsAbortControllerRef.current) {
      productsAbortControllerRef.current.abort();
    }
    const controller = new AbortController();
    productsAbortControllerRef.current = controller;

    setIsLoadingProducts(true);
    setLoadError(null);

    try {
      const res = await warehouseApi.fetchProducts(controller.signal);
      if (!isMountedRef.current || controller.signal.aborted || productsAbortControllerRef.current !== controller) {
        return;
      }

      if (res.success) {
        setServerProducts(res.data);
      } else {
        setLoadError(res.error.message);
      }
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return;
      }
      if (!isMountedRef.current || controller.signal.aborted || productsAbortControllerRef.current !== controller) {
        return;
      }
      setLoadError('Не удалось загрузить каталог товаров. Проверьте подключение к сети.');
    } finally {
      if (isMountedRef.current && productsAbortControllerRef.current === controller) {
        setIsLoadingProducts(false);
      }
    }
  }, [userId]);

  // Lifecycle & user synchronization
  useEffect(() => {
    isMountedRef.current = true;
    if (!userId) {
      return;
    }

    void Promise.resolve().then(() => {
      if (isMountedRef.current) {
        loadProducts();
      }
    });

    return () => {
      isMountedRef.current = false;
      if (productsAbortControllerRef.current) {
        productsAbortControllerRef.current.abort();
      }
      if (movementsAbortControllerRef.current) {
        movementsAbortControllerRef.current.abort();
      }
    };
  }, [userId, loadProducts]);

  // 2. Fetch movements for product modal
  const loadMovementsForProduct = useCallback(async (product: Product) => {
    if (movementsAbortControllerRef.current) {
      movementsAbortControllerRef.current.abort();
    }
    const controller = new AbortController();
    movementsAbortControllerRef.current = controller;

    setIsLoadingMovements(true);
    setMovementsError(null);
    setMovementsList([]);

    try {
      const res = await warehouseApi.fetchProductMovements(product.id, controller.signal);
      if (!isMountedRef.current || controller.signal.aborted || movementsAbortControllerRef.current !== controller) {
        return;
      }

      if (res.success) {
        setMovementsList(res.data);
      } else {
        setMovementsError(res.error.message);
      }
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return;
      }
      if (!isMountedRef.current || controller.signal.aborted || movementsAbortControllerRef.current !== controller) {
        return;
      }
      setMovementsError('Ошибка при загрузке истории движений.');
    } finally {
      if (isMountedRef.current && movementsAbortControllerRef.current === controller) {
        setIsLoadingMovements(false);
      }
    }
  }, []);

  // 3. Stats calculation based on real server products
  const stats = useMemo(() => {
    const totalCount = serverProducts.length;
    const totalCost = serverProducts.reduce(
      (sum, p) => sum + p.purchasePrice * p.stock,
      0
    );
    const lowStockCount = serverProducts.filter((p) => p.status === 'low_stock').length;
    const outOfStockCount = serverProducts.filter((p) => p.status === 'out_of_stock').length;

    return {
      totalCount,
      totalCost,
      lowStockCount,
      outOfStockCount,
    };
  }, [serverProducts]);

  // 4. Filtering
  const filteredProducts = useMemo(() => {
    return serverProducts.filter((item) => {
      if (filters.searchQuery.trim()) {
        const q = filters.searchQuery.trim().toLowerCase();
        const matchName = item.name.toLowerCase().includes(q);
        const matchSku = item.sku.toLowerCase().includes(q);
        const matchBarcode = item.barcode.toLowerCase().includes(q);
        if (!matchName && !matchSku && !matchBarcode) {
          return false;
        }
      }

      if (filters.category !== 'all' && item.category !== filters.category) {
        return false;
      }

      if (filters.status !== 'all' && item.status !== filters.status) {
        return false;
      }

      return true;
    });
  }, [serverProducts, filters]);

  // 5. Sorting
  const sortedProducts = useMemo(() => {
    const list = [...filteredProducts];
    const { field, direction } = sortConfig;

    list.sort((a, b) => {
      let comparison = 0;
      if (field === 'name') {
        comparison = a.name.localeCompare(b.name, 'ru');
      } else {
        comparison = a[field] - b[field];
      }
      return direction === 'asc' ? comparison : -comparison;
    });

    return list;
  }, [filteredProducts, sortConfig]);

  // 6. Pagination
  const totalPages = Math.ceil(sortedProducts.length / pageSize) || 1;
  const safeCurrentPage = Math.min(currentPage, totalPages);

  const paginatedProducts = useMemo(() => {
    const startIndex = (safeCurrentPage - 1) * pageSize;
    return sortedProducts.slice(startIndex, startIndex + pageSize);
  }, [sortedProducts, safeCurrentPage, pageSize]);

  // Handlers
  const handleSort = (field: ProductSortField) => {
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

  const handleOpenAddModal = () => {
    if (!isAdmin) return;
    setProductToEdit(null);
    setIsFormModalOpen(true);
  };

  const handleOpenEditModal = (product: Product) => {
    if (!isAdmin) return;
    setProductToEdit(product);
    setIsFormModalOpen(true);
  };

  const handleOpenAdjustStockModal = (product: Product) => {
    if (!isAdmin) return;
    setProductToAdjust(product);
  };

  const handleOpenMovementsModal = (product: Product) => {
    setProductForMovements(product);
    loadMovementsForProduct(product);
  };

  const handleOpenArchiveModal = (product: Product) => {
    if (!isAdmin) return;
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
    if (!isAdmin) {
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
        const saved = res.data;
        setServerProducts((prev) =>
          prev.map((item) => (item.id === saved.id ? saved : item))
        );
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
        const created = res.data;
        setServerProducts((prev) => [created, ...prev.filter((p) => p.id !== created.id)]);
      }

      // Background refetch to guarantee absolute consistency with database
      void loadProducts();
      return { success: true };
    } finally {
      setIsFormSubmitting(false);
    }
  };

  const handleAdjustStockSubmit = async (params: {
    productId: string;
    newStock: number;
    reason: string;
  }): Promise<{ success: boolean; error?: string }> => {
    if (!isAdmin) {
      return { success: false, error: 'Недостаточно прав для выполнения операции' };
    }

    const res = await warehouseApi.adjustStock(params);
    if (!res.success) {
      return { success: false, error: res.error.message };
    }

    // Apply adjusted product immediately to catalog
    const adjusted = res.data;
    setServerProducts((prev) =>
      prev.map((item) => (item.id === adjusted.id ? adjusted : item))
    );

    // Refresh products catalog in background
    void loadProducts();

    // If movements modal happens to be open for this product, refresh movements too
    if (productForMovements && productForMovements.id === params.productId) {
      loadMovementsForProduct(res.data);
    }

    return { success: true };
  };

  const handleArchiveConfirm = async (product: Product) => {
    if (!isAdmin) return;
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
      setServerProducts((prev) => prev.filter((p) => p.id !== product.id));
      setProductToArchive((current) => (current?.id === product.id ? null : current));
      void loadProducts();
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

  const handleCloseMovementsModal = useCallback(() => {
    if (movementsAbortControllerRef.current) {
      movementsAbortControllerRef.current.abort();
    }
    setProductForMovements(null);
    setMovementsList([]);
    setMovementsError(null);
  }, []);

  const handleExportCSV = () => {
    exportProductsToCSV(sortedProducts, 'smart-store-sklad.csv');
  };

  return (
    <div className={styles.warehousePage}>
      {/* Page Header */}
      <header className={styles.pageHeader}>
        <div className={styles.headerTitles}>
          <h1 className={styles.title}>Склад</h1>
          <p className={styles.subtitle}>Управление товарами и остатками (Supabase)</p>
        </div>

        {isAdmin && (
          <button
            type="button"
            data-add-product-btn
            className={styles.addBtnHeader}
            onClick={handleOpenAddModal}
          >
            <Plus size={16} />
            <span>Добавить товар</span>
          </button>
        )}
      </header>

      {/* Network / Query Error Banner */}
      {loadError && (
        <div className={styles.errorBanner} role="alert">
          <div className={styles.errorInfo}>
            <AlertCircle size={20} />
            <span className={styles.errorText}>{loadError}</span>
          </div>
          <button
            type="button"
            className={styles.retryBtn}
            onClick={() => {
              restoreFocusWithFallback(null, '[data-add-product-btn]');
              void loadProducts();
            }}
          >
            <RotateCcw size={14} />
            <span>Повторить</span>
          </button>
        </div>
      )}

      {/* 4 Stat Cards */}
      <WarehouseStats
        totalCount={stats.totalCount}
        totalCost={stats.totalCost}
        lowStockCount={stats.lowStockCount}
        outOfStockCount={stats.outOfStockCount}
      />

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
        canAddProduct={isAdmin}
      />

      {/* Products Table or Compact Loading State */}
      {isLoadingProducts ? (
        <div className={styles.tableLoadingCard} role="status" aria-live="polite">
          <div className={styles.spinner} aria-hidden="true" />
          <span className={styles.loadingText}>Загрузка каталога товаров из Supabase...</span>
        </div>
      ) : (
        <ProductsTable
          products={paginatedProducts}
          sortConfig={sortConfig}
          onSort={handleSort}
          onEditProduct={handleOpenEditModal}
          onAdjustStock={handleOpenAdjustStockModal}
          onViewMovements={handleOpenMovementsModal}
          onArchiveProduct={handleOpenArchiveModal}
          onResetFilters={handleResetFilters}
          canManageProducts={isAdmin}
        />
      )}

      {/* Pagination */}
      {!isLoadingProducts && (
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
          existingProducts={serverProducts}
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

      {/* Product Movements History Modal */}
      <ProductMovementsModal
        isOpen={Boolean(productForMovements)}
        product={productForMovements}
        movements={movementsList}
        isLoading={isLoadingMovements}
        error={movementsError}
        onRetry={() => {
          if (productForMovements) {
            loadMovementsForProduct(productForMovements);
          }
        }}
        onClose={handleCloseMovementsModal}
      />
    </div>
  );
};
