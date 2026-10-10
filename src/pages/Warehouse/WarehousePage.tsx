import { useState, useMemo } from 'react';
import { Plus } from 'lucide-react';
import type {
  Product,
  ProductFilters,
  ProductSortConfig,
  ProductSortField,
  ProductFormData,
} from '../../types';
import { exportProductsToCSV } from '../../utils/csvUtils';
import { useInventory } from '../../context';
import { WarehouseStats } from '../../components/warehouse/WarehouseStats/WarehouseStats';
import { WarehouseToolbar } from '../../components/warehouse/WarehouseToolbar/WarehouseToolbar';
import { ProductsTable } from '../../components/warehouse/ProductsTable/ProductsTable';
import { Pagination } from '../../components/warehouse/Pagination/Pagination';
import { ProductFormModal } from '../../components/warehouse/ProductFormModal/ProductFormModal';
import { ArchiveProductModal } from '../../components/warehouse/ArchiveProductModal/ArchiveProductModal';
import { ProductMovementsModal } from '../../components/warehouse/ProductMovementsModal/ProductMovementsModal';
import styles from './WarehousePage.module.scss';

export const WarehousePage = () => {
  const {
    products,
    activeProducts,
    addProduct,
    updateProduct,
    archiveProduct,
    getProductMovements,
  } = useInventory();

  const [filters, setFilters] = useState<ProductFilters>({
    searchQuery: '',
    category: 'all',
    status: 'all',
  });
  const [sortConfig, setSortConfig] = useState<ProductSortConfig>({
    field: 'name',
    direction: 'asc',
  });
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 6; // matching mockup ("Показано 1–6 из ...")

  // Modal states
  const [isFormModalOpen, setIsFormModalOpen] = useState(false);
  const [productToEdit, setProductToEdit] = useState<Product | null>(null);
  const [productToArchive, setProductToArchive] = useState<Product | null>(null);
  const [productForMovements, setProductForMovements] = useState<Product | null>(null);

  // Stats calculation
  const stats = useMemo(() => {
    const totalCount = activeProducts.length;
    const totalCost = activeProducts.reduce(
      (sum, p) => sum + p.purchasePrice * p.stock,
      0
    );
    const lowStockCount = activeProducts.filter((p) => p.status === 'low_stock').length;
    const outOfStockCount = activeProducts.filter((p) => p.status === 'out_of_stock').length;

    return {
      totalCount,
      totalCost,
      lowStockCount,
      outOfStockCount,
    };
  }, [activeProducts]);

  // Filtering (only active products displayed in the main table)
  const filteredProducts = useMemo(() => {
    return activeProducts.filter((item) => {
      // Search
      if (filters.searchQuery.trim()) {
        const q = filters.searchQuery.trim().toLowerCase();
        const matchName = item.name.toLowerCase().includes(q);
        const matchSku = item.sku.toLowerCase().includes(q);
        const matchBarcode = item.barcode.toLowerCase().includes(q);
        if (!matchName && !matchSku && !matchBarcode) {
          return false;
        }
      }

      // Category
      if (filters.category !== 'all' && item.category !== filters.category) {
        return false;
      }

      // Status
      if (filters.status !== 'all' && item.status !== filters.status) {
        return false;
      }

      return true;
    });
  }, [activeProducts, filters]);

  // Sorting
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

  // Pagination
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
    setProductToEdit(null);
    setIsFormModalOpen(true);
  };

  const handleOpenEditModal = (product: Product) => {
    setProductToEdit(product);
    setIsFormModalOpen(true);
  };

  const handleFormSubmit = (data: ProductFormData) => {
    if (productToEdit) {
      return updateProduct(productToEdit.id, data);
    } else {
      addProduct(data);
      return { success: true };
    }
  };

  const handleArchiveConfirm = (product: Product) => {
    archiveProduct(product.id);
  };

  const handleExportCSV = () => {
    exportProductsToCSV(sortedProducts, 'smart-store-sklad.csv');
  };

  return (
    <div className={styles.warehousePage}>
      {/* Page Header */}
      <header className={styles.pageHeader}>
        <div className={styles.headerTitles}>
          <h1 className={styles.title}>Склад</h1>
          <p className={styles.subtitle}>Управление товарами и остатками</p>
        </div>

        <button
          type="button"
          data-add-product-btn
          className={styles.addBtnHeader}
          onClick={handleOpenAddModal}
        >
          <Plus size={16} />
          <span>Добавить товар</span>
        </button>
      </header>

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
      />

      {/* Products Table */}
      <ProductsTable
        products={paginatedProducts}
        sortConfig={sortConfig}
        onSort={handleSort}
        onEditProduct={handleOpenEditModal}
        onViewMovements={(prod) => setProductForMovements(prod)}
        onArchiveProduct={(prod) => setProductToArchive(prod)}
        onResetFilters={handleResetFilters}
      />

      {/* Pagination */}
      <Pagination
        currentPage={safeCurrentPage}
        totalPages={totalPages}
        totalItems={sortedProducts.length}
        pageSize={pageSize}
        onPageChange={(page) => setCurrentPage(page)}
      />

      {/* Add / Edit Product Modal */}
      {isFormModalOpen && (
        <ProductFormModal
          key={productToEdit?.id ?? 'new-product'}
          isOpen={isFormModalOpen}
          productToEdit={productToEdit}
          existingProducts={products}
          onClose={() => {
            setIsFormModalOpen(false);
            setProductToEdit(null);
          }}
          onSubmit={handleFormSubmit}
        />
      )}

      {/* Archive Product Confirmation Modal */}
      <ArchiveProductModal
        isOpen={Boolean(productToArchive)}
        product={productToArchive}
        onClose={() => setProductToArchive(null)}
        onConfirm={handleArchiveConfirm}
      />

      {/* Product Movements History Modal */}
      <ProductMovementsModal
        isOpen={Boolean(productForMovements)}
        product={productForMovements}
        movements={productForMovements ? getProductMovements(productForMovements.id) : []}
        onClose={() => setProductForMovements(null)}
      />
    </div>
  );
};
