import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  MoreHorizontal,
  Edit2,
  History,
  Archive,
  PackageOpen,
} from 'lucide-react';
import type {
  Product,
  ProductSortField,
  ProductSortConfig,
} from '../../../types';
import { Badge } from '../../common/Badge/Badge';
import { ProductThumbnail } from '../../common/ProductThumbnail/ProductThumbnail';
import { formatCurrency } from '../../../utils/formatUtils';
import { getStockStatusLabel } from '../../../utils/productUtils';
import styles from './ProductsTable.module.scss';

export interface ProductsTableProps {
  products: Product[];
  sortConfig: ProductSortConfig;
  onSort: (field: ProductSortField) => void;
  onEditProduct: (product: Product) => void;
  onViewMovements: (product: Product) => void;
  onArchiveProduct: (product: Product) => void;
  onResetFilters: () => void;
}

interface MenuCoords {
  top: number;
  left: number;
}

export const ProductsTable = ({
  products,
  sortConfig,
  onSort,
  onEditProduct,
  onViewMovements,
  onArchiveProduct,
  onResetFilters,
}: ProductsTableProps) => {
  const [activeMenuProduct, setActiveMenuProduct] = useState<Product | null>(null);
  const [menuCoords, setMenuCoords] = useState<MenuCoords | null>(null);
  const activeTriggerRef = useRef<HTMLButtonElement | null>(null);
  const dropdownMenuRef = useRef<HTMLDivElement | null>(null);

  const closeMenu = (restoreFocus = true) => {
    const trigger = activeTriggerRef.current;
    setActiveMenuProduct(null);
    setMenuCoords(null);
    if (restoreFocus && trigger && document.contains(trigger)) {
      trigger.focus();
    }
  };

  // Focus first menu item when menu opens
  useEffect(() => {
    if (!activeMenuProduct) return;

    const focusFirstItem = () => {
      const firstItem = dropdownMenuRef.current?.querySelector<HTMLButtonElement>(
        '[role="menuitem"]:not([disabled])'
      );
      firstItem?.focus();
    };

    focusFirstItem();
    const rafId = requestAnimationFrame(focusFirstItem);

    return () => cancelAnimationFrame(rafId);
  }, [activeMenuProduct]);

  // Accessible keyboard navigation for the menu
  const handleMenuKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const menuEl = dropdownMenuRef.current;
    if (!menuEl) return;

    const items = Array.from(
      menuEl.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([disabled])')
    );
    if (items.length === 0) return;

    const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const nextIndex =
        currentIndex === -1 || currentIndex === items.length - 1 ? 0 : currentIndex + 1;
      items[nextIndex]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prevIndex = currentIndex <= 0 ? items.length - 1 : currentIndex - 1;
      items[prevIndex]?.focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      items[0]?.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      items[items.length - 1]?.focus();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeMenu(true);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      closeMenu(true);
    }
  };

  // Close menu on outside click, Escape, scroll or resize
  useEffect(() => {
    if (!activeMenuProduct) return;

    const handleScrollOrResize = () => {
      closeMenu(false);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeMenu(true);
      }
    };

    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        dropdownMenuRef.current &&
        !dropdownMenuRef.current.contains(target) &&
        activeTriggerRef.current &&
        !activeTriggerRef.current.contains(target)
      ) {
        closeMenu(false);
      }
    };

    window.addEventListener('scroll', handleScrollOrResize, true);
    window.addEventListener('resize', handleScrollOrResize);
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('scroll', handleScrollOrResize, true);
      window.removeEventListener('resize', handleScrollOrResize);
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [activeMenuProduct]);

  const handleToggleMenu = (
    e: React.MouseEvent<HTMLButtonElement>,
    product: Product
  ) => {
    if (activeMenuProduct?.id === product.id) {
      closeMenu(true);
      return;
    }

    const trigger = e.currentTarget;
    activeTriggerRef.current = trigger;

    const rect = trigger.getBoundingClientRect();
    const menuWidth = 196;
    const menuHeight = 126;

    // Determine vertical placement: open upwards if space below is limited
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const openUpwards = spaceBelow < menuHeight + 12 && spaceAbove >= menuHeight + 12;

    let top = openUpwards ? rect.top - menuHeight - 4 : rect.bottom + 4;
    let left = rect.right - menuWidth;

    // Viewport boundaries
    if (left + menuWidth > window.innerWidth - 8) {
      left = window.innerWidth - menuWidth - 8;
    }
    if (left < 8) {
      left = 8;
    }
    if (top < 8) {
      top = 8;
    } else if (top + menuHeight > window.innerHeight - 8) {
      top = window.innerHeight - menuHeight - 8;
    }

    setMenuCoords({ top, left });
    setActiveMenuProduct(product);
  };

  const renderSortIndicator = (field: ProductSortField) => {
    if (sortConfig.field !== field) {
      return <ArrowUpDown size={13} className={styles.sortInactive} aria-hidden="true" />;
    }
    return sortConfig.direction === 'asc' ? (
      <ArrowUp size={13} className={styles.sortActive} aria-hidden="true" />
    ) : (
      <ArrowDown size={13} className={styles.sortActive} aria-hidden="true" />
    );
  };

  const getStatusBadgeVariant = (status: Product['status']) => {
    switch (status) {
      case 'in_stock':
        return 'success';
      case 'low_stock':
        return 'warning';
      case 'out_of_stock':
        return 'danger';
    }
  };

  if (products.length === 0) {
    return (
      <div className={styles.emptyContainer}>
        <div className={styles.emptyIconBox}>
          <PackageOpen size={40} className={styles.emptyIcon} />
        </div>
        <h3 className={styles.emptyTitle}>Товары не найдены</h3>
        <p className={styles.emptySubtitle}>
          По вашему запросу ничего не найдено. Попробуйте изменить поисковый запрос или сбросить фильтры.
        </p>
        <button
          type="button"
          className={styles.emptyResetBtn}
          onClick={onResetFilters}
        >
          Сбросить фильтры
        </button>
      </div>
    );
  }

  return (
    <div className={styles.tableCard}>
      <div className={styles.tableResponsiveWrapper}>
        <table className={styles.table} aria-label="Список товаров склада">
          <thead>
            <tr>
              <th scope="col" className={styles.productTh}>
                <button
                  type="button"
                  className={styles.sortableHeaderBtn}
                  onClick={() => onSort('name')}
                  aria-label="Сортировать по наименованию товара"
                >
                  <span>Товар</span>
                  {renderSortIndicator('name')}
                </button>
              </th>
              <th scope="col" className={styles.skuTh}>Артикул / Штрихкод</th>
              <th scope="col" className={styles.categoryTh}>Категория</th>
              <th scope="col" className={styles.priceTh}>
                <button
                  type="button"
                  className={styles.sortableHeaderBtn}
                  onClick={() => onSort('purchasePrice')}
                  aria-label="Сортировать по цене закупки"
                >
                  <span>Закупка</span>
                  {renderSortIndicator('purchasePrice')}
                </button>
              </th>
              <th scope="col" className={styles.priceTh}>
                <button
                  type="button"
                  className={styles.sortableHeaderBtn}
                  onClick={() => onSort('sellingPrice')}
                  aria-label="Сортировать по цене продажи"
                >
                  <span>Продажа</span>
                  {renderSortIndicator('sellingPrice')}
                </button>
              </th>
              <th scope="col" className={styles.stockTh}>
                <button
                  type="button"
                  className={styles.sortableHeaderBtn}
                  onClick={() => onSort('stock')}
                  aria-label="Сортировать по остатку"
                >
                  <span>Остаток</span>
                  {renderSortIndicator('stock')}
                </button>
              </th>
              <th scope="col" className={styles.statusTh}>Статус</th>
              <th scope="col" className={styles.actionsTh}>
                <span className="visually-hidden">Действия</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {products.map((product) => (
              <tr key={product.id} className={styles.tableRow}>
                {/* Product with Icon & Description */}
                <td className={styles.productCell}>
                  <div className={styles.productFlex}>
                    <ProductThumbnail
                      type={product.iconType}
                      alt={product.name}
                      size="sm"
                    />
                    <div className={styles.productMeta}>
                      <span className={styles.productName} title={product.name}>
                        {product.name}
                      </span>
                      {product.description && (
                        <span className={styles.productDesc} title={product.description}>
                          {product.description}
                        </span>
                      )}
                    </div>
                  </div>
                </td>

                {/* SKU and Barcode */}
                <td className={styles.skuCell}>
                  <span className={styles.skuText}>{product.sku}</span>
                  <span className={styles.barcodeText}>{product.barcode}</span>
                </td>

                {/* Category */}
                <td className={styles.categoryCell}>
                  <span className={`${styles.categoryBadge} ${styles[`cat-${product.category}`] || ''}`}>
                    {product.categoryLabel}
                  </span>
                </td>

                {/* Purchase Price */}
                <td className={styles.purchaseCell}>
                  {formatCurrency(product.purchasePrice)}
                </td>

                {/* Selling Price */}
                <td className={styles.sellingCell}>
                  {formatCurrency(product.sellingPrice)}
                </td>

                {/* Stock Quantity + Min stock threshold */}
                <td className={styles.stockCell}>
                  <span className={styles.stockValue}>{product.stock} {product.unit}</span>
                  <span className={styles.minStockText}>мин: {product.minStockThreshold} {product.unit}</span>
                </td>

                {/* Automatic Status Badge */}
                <td className={styles.statusCell}>
                  <Badge variant={getStatusBadgeVariant(product.status)} dot>
                    {getStockStatusLabel(product.status)}
                  </Badge>
                </td>

                {/* Actions Trigger Button */}
                <td className={styles.actionsCell}>
                  <div className={styles.actionMenuWrapper}>
                    <button
                      type="button"
                      className={styles.moreBtn}
                      onClick={(e) => handleToggleMenu(e, product)}
                      aria-label={`Действия с товаром ${product.name}`}
                      aria-haspopup="menu"
                      aria-expanded={activeMenuProduct?.id === product.id}
                      aria-controls={
                        activeMenuProduct?.id === product.id
                          ? 'product-actions-menu'
                          : undefined
                      }
                    >
                      <MoreHorizontal size={18} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Action dropdown rendered via createPortal in document.body to avoid clipping */}
      {activeMenuProduct && menuCoords && typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={dropdownMenuRef}
            id="product-actions-menu"
            className={styles.actionDropdownPortal}
            style={{
              position: 'fixed',
              top: `${menuCoords.top}px`,
              left: `${menuCoords.left}px`,
            }}
            role="menu"
            aria-label={`Действия с товаром ${activeMenuProduct.name}`}
            tabIndex={-1}
            onKeyDown={handleMenuKeyDown}
          >
            <button
              type="button"
              className={styles.menuItem}
              role="menuitem"
              onClick={() => {
                const prod = activeMenuProduct;
                closeMenu(true);
                onEditProduct(prod);
              }}
            >
              <Edit2 size={14} className={styles.menuIcon} />
              <span>Редактировать</span>
            </button>
            <button
              type="button"
              className={styles.menuItem}
              role="menuitem"
              onClick={() => {
                const prod = activeMenuProduct;
                closeMenu(true);
                onViewMovements(prod);
              }}
            >
              <History size={14} className={styles.menuIcon} />
              <span>Посмотреть движения</span>
            </button>
            <div className={styles.menuDivider} />
            <button
              type="button"
              className={`${styles.menuItem} ${styles.menuItemArchive}`}
              role="menuitem"
              onClick={() => {
                const prod = activeMenuProduct;
                closeMenu(true);
                onArchiveProduct(prod);
              }}
            >
              <Archive size={14} className={styles.menuIcon} />
              <span>Архивировать</span>
            </button>
          </div>,
          document.body
        )}
    </div>
  );
};
