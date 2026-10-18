import { useState, useEffect, useCallback, useRef } from 'react';
import type { Product, Sale } from '../../../types';
import { salesApi } from '../../../api/sales';
import { warehouseApi } from '../../../api/warehouse';
import { restoreFocusWithFallback } from '../../../utils/focusUtils';

interface UseSalesDataOptions {
  userId: string | null;
  isAnyModalOpen: () => boolean;
  /**
   * Called with freshly loaded receipts.
   * Returns true when a pending sale was confirmed (focus is then returned to the add button).
   */
  onSalesLoaded?: (sales: Sale[]) => boolean;
}

/**
 * Loads receipts (sales + sale_items) and active catalog products from Supabase.
 * Supabase is the only data source of the Sales page (InventoryContext is not used or updated).
 * - Each loader cancels its previous in-flight request (AbortController) and ignores stale responses.
 * - State is reset when the authenticated user changes.
 * - Retry handlers restore focus to the retry button on failure or to the add button on success.
 * - loadProducts resolves with the fresh catalog (or null) for the pre-submit freshness check.
 */
export const useSalesData = ({
  userId,
  isAnyModalOpen,
  onSalesLoaded,
}: UseSalesDataOptions) => {
  const [sales, setSales] = useState<Sale[]>([]);
  const [isLoadingSales, setIsLoadingSales] = useState<boolean>(true);
  const [salesLoadError, setSalesLoadError] = useState<string | null>(null);
  const [isSalesTruncated, setIsSalesTruncated] = useState<boolean>(false);

  const [products, setProducts] = useState<Product[]>([]);
  const [isLoadingProducts, setIsLoadingProducts] = useState<boolean>(true);
  const [productsLoadError, setProductsLoadError] = useState<string | null>(null);

  const salesAbortControllerRef = useRef<AbortController | null>(null);
  const productsAbortControllerRef = useRef<AbortController | null>(null);
  const isMountedRef = useRef<boolean>(true);

  // Latest-callback ref: loaders always see the current handler without being recreated
  const onSalesLoadedRef = useRef(onSalesLoaded);
  useEffect(() => {
    onSalesLoadedRef.current = onSalesLoaded;
  }, [onSalesLoaded]);

  // Reset state on user switch or logout
  const [prevUserId, setPrevUserId] = useState<string | null>(userId);
  if (prevUserId !== userId) {
    setPrevUserId(userId);
    setSales([]);
    setIsLoadingSales(Boolean(userId));
    setSalesLoadError(null);
    setIsSalesTruncated(false);
    setProducts([]);
    setIsLoadingProducts(Boolean(userId));
    setProductsLoadError(null);
  }

  const loadSales = useCallback(async (isRetry = false) => {
    if (!userId) return;

    if (salesAbortControllerRef.current) {
      salesAbortControllerRef.current.abort();
    }
    const controller = new AbortController();
    salesAbortControllerRef.current = controller;

    setIsLoadingSales(true);
    if (!isRetry) {
      setSalesLoadError(null);
    }
    let pendingConfirmed = false;
    let resSuccess = false;

    try {
      const res = await salesApi.fetchSales({ signal: controller.signal });
      if (
        !isMountedRef.current ||
        controller.signal.aborted ||
        salesAbortControllerRef.current !== controller
      ) {
        return;
      }

      if (res.success) {
        resSuccess = true;
        setSalesLoadError(null);
        setSales(res.data.sales);
        setIsSalesTruncated(res.data.isTruncated);
        pendingConfirmed = onSalesLoadedRef.current?.(res.data.sales) ?? false;
      } else {
        setSalesLoadError(res.error.message);
      }
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return;
      }
      if (
        !isMountedRef.current ||
        controller.signal.aborted ||
        salesAbortControllerRef.current !== controller
      ) {
        return;
      }
      setSalesLoadError('Не удалось загрузить чеки продаж. Проверьте подключение к сети.');
    } finally {
      if (
        isMountedRef.current &&
        salesAbortControllerRef.current === controller
      ) {
        setIsLoadingSales(false);
        if (pendingConfirmed) {
          requestAnimationFrame(() => {
            if (isMountedRef.current && !isAnyModalOpen()) {
              restoreFocusWithFallback(null, '[data-add-sale-btn]');
            }
          });
        } else if (isRetry) {
          requestAnimationFrame(() => {
            if (!isMountedRef.current || isAnyModalOpen()) return;
            if (resSuccess) {
              restoreFocusWithFallback(null, '[data-add-sale-btn]');
            } else {
              const retryBtn = document.querySelector<HTMLButtonElement>(
                '[data-retry-sales-btn]'
              );
              if (retryBtn && !retryBtn.disabled) {
                retryBtn.focus();
              } else {
                restoreFocusWithFallback(null, '[data-add-sale-btn]');
              }
            }
          });
        }
      }
    }
  }, [userId, isAnyModalOpen]);

  const loadProducts = useCallback(async (isRetry = false): Promise<Product[] | null> => {
    if (!userId) return null;

    if (productsAbortControllerRef.current) {
      productsAbortControllerRef.current.abort();
    }
    const controller = new AbortController();
    productsAbortControllerRef.current = controller;

    setIsLoadingProducts(true);
    if (!isRetry) {
      setProductsLoadError(null);
    }
    let resSuccess = false;
    let freshProducts: Product[] | null = null;

    try {
      const res = await warehouseApi.fetchProducts(controller.signal);
      if (
        !isMountedRef.current ||
        controller.signal.aborted ||
        productsAbortControllerRef.current !== controller
      ) {
        return null;
      }

      if (res.success) {
        resSuccess = true;
        freshProducts = res.data;
        setProductsLoadError(null);
        setProducts(res.data);
      } else {
        setProductsLoadError(res.error.message);
      }
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return null;
      }
      if (
        !isMountedRef.current ||
        controller.signal.aborted ||
        productsAbortControllerRef.current !== controller
      ) {
        return null;
      }
      setProductsLoadError('Не удалось загрузить каталог товаров.');
    } finally {
      if (
        isMountedRef.current &&
        productsAbortControllerRef.current === controller
      ) {
        setIsLoadingProducts(false);
        if (isRetry) {
          requestAnimationFrame(() => {
            if (!isMountedRef.current || isAnyModalOpen()) return;
            if (resSuccess) {
              restoreFocusWithFallback(null, '[data-add-sale-btn]');
            } else {
              const retryBtn = document.querySelector<HTMLButtonElement>(
                '[data-retry-products-btn]'
              );
              if (retryBtn && !retryBtn.disabled) {
                retryBtn.focus();
              } else {
                restoreFocusWithFallback(null, '[data-add-sale-btn]');
              }
            }
          });
        }
      }
    }
    return freshProducts;
  }, [userId, isAnyModalOpen]);

  const reloadAll = useCallback(async () => {
    await Promise.all([loadSales(), loadProducts()]);
  }, [loadSales, loadProducts]);

  // Lifecycle & data loading
  useEffect(() => {
    isMountedRef.current = true;
    if (!userId) return;

    void Promise.resolve().then(() => {
      if (isMountedRef.current) {
        void loadSales();
        void loadProducts();
      }
    });

    return () => {
      isMountedRef.current = false;
      if (salesAbortControllerRef.current) {
        salesAbortControllerRef.current.abort();
      }
      if (productsAbortControllerRef.current) {
        productsAbortControllerRef.current.abort();
      }
    };
  }, [userId, loadSales, loadProducts]);

  return {
    sales,
    isLoadingSales,
    salesLoadError,
    isSalesTruncated,
    products,
    isLoadingProducts,
    productsLoadError,
    loadSales,
    loadProducts,
    reloadAll,
  };
};
