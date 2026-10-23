import { useState, useEffect, useCallback, useRef } from 'react';
import type { IncomeCatalogProduct } from '../../../types';
import { warehouseApi } from '../../../api/warehouse';
import { mapCatalogToIncomeProducts } from '../../../api/income';

const ADMIN_ONLY_MESSAGE =
  'Каталог прихода доступен только администратору. Обновите страницу или войдите заново.';

interface UseIncomeCatalogOptions {
  userId: string | null;
  /** Income is admin-only: the catalog is loaded only for an active admin. */
  isAdmin: boolean;
}

/**
 * Active catalog of the Income form via the role-aware rpc_list_products (admin response with
 * purchase prices). All keyset pages or nothing: a failed / inconsistent load never yields a
 * partial catalog. A user switch or a role change aborts the request and clears the products.
 * After a failed reload the previous COMPLETE catalog stays (creation is disabled by the error).
 */
export const useIncomeCatalog = ({ userId, isAdmin }: UseIncomeCatalogOptions) => {
  const enabled = Boolean(userId) && isAdmin;
  const resetKey = `${userId ?? ''}|${isAdmin ? 'admin' : 'staff'}`;

  const [products, setProducts] = useState<IncomeCatalogProduct[]>([]);
  const [isLoadingProducts, setIsLoadingProducts] = useState<boolean>(enabled);
  const [productsLoadError, setProductsLoadError] = useState<string | null>(null);

  const controllerRef = useRef<AbortController | null>(null);
  const isMountedRef = useRef<boolean>(true);

  // Reset on user switch, logout or role change: never keep a catalog loaded under another role
  const [prevResetKey, setPrevResetKey] = useState(resetKey);
  if (prevResetKey !== resetKey) {
    setPrevResetKey(resetKey);
    setProducts([]);
    setIsLoadingProducts(enabled);
    setProductsLoadError(null);
  }

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      controllerRef.current?.abort();
    };
  }, []);

  const loadProducts = useCallback(async () => {
    if (!enabled) return;

    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const isCurrent = () =>
      isMountedRef.current && !controller.signal.aborted && controllerRef.current === controller;

    setIsLoadingProducts(true);
    setProductsLoadError(null);

    try {
      const res = await warehouseApi.listCatalog(controller.signal);
      if (!isCurrent()) return;

      if (res.success) {
        const mapped = mapCatalogToIncomeProducts(res.data);
        if (mapped) {
          setProducts(mapped);
        } else {
          setProducts([]);
          setProductsLoadError(ADMIN_ONLY_MESSAGE);
        }
      } else {
        setProductsLoadError(res.error.message);
      }
    } catch (err: unknown) {
      if ((err instanceof DOMException && err.name === 'AbortError') || !isCurrent()) return;
      setProductsLoadError('Не удалось загрузить каталог товаров.');
    } finally {
      if (isMountedRef.current && controllerRef.current === controller) {
        setIsLoadingProducts(false);
      }
    }
  }, [enabled]);

  // Primary load per user / role; the cleanup aborts it on leave or switch
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (!cancelled && isMountedRef.current) void loadProducts();
    });
    return () => {
      cancelled = true;
      controllerRef.current?.abort();
      controllerRef.current = null;
    };
  }, [enabled, resetKey, loadProducts]);

  return { products, isLoadingProducts, productsLoadError, loadProducts };
};
