import { useState, useEffect, useCallback, useRef } from 'react';
import type { WarehouseCatalog, WarehouseCatalogProduct, WarehouseViewMode } from '../../../types';
import { warehouseApi } from '../../../api/warehouse';
import { restoreFocusWithFallback } from '../../../utils/focusUtils';

export const CATALOG_RETRY_BUTTON_SELECTOR = '[data-retry-warehouse-catalog-btn]';
/** Focus target after a successful retry: «Добавить товар» (admin) or the search field. */
const CATALOG_SUCCESS_FOCUS_SELECTOR = '[data-add-product-btn], [data-warehouse-search]';

interface CatalogState {
  /** Last COMPLETE catalog (all pages); never a partially loaded one. */
  catalog: WarehouseCatalog | null;
  isLoading: boolean;
  error: string | null;
}

export type CatalogLoadMode = 'primary' | 'background' | 'retry';

interface UseWarehouseCatalogOptions {
  userId: string | null;
  isAdmin: boolean;
  /** 'active' → rpc_list_products (default); 'archived' → admin-only rpc_list_archived_products. */
  source?: WarehouseViewMode;
  /** false: nothing is loaded and any loaded data is dropped (e.g. the archive view is closed). */
  enabled?: boolean;
}

const initialState = (enabled: boolean): CatalogState => ({
  catalog: null,
  isLoading: enabled,
  error: null,
});

/**
 * Warehouse catalog via the role-aware rpc_list_products:
 * - one AbortController; leaving the page, a user switch or a role change aborts the request
 *   and clears the catalog (admin data never stays visible after the role was lost);
 * - a failed load never shows a partial catalog: primary → no catalog + error; background
 *   (after a mutation) → the previous complete catalog stays visible next to the error;
 * - retry restores focus only if it was lost (retry button removed / disabled);
 * - the source / enabled flag are part of the reset key: switching them aborts and clears too.
 */
export const useWarehouseCatalog = ({
  userId,
  isAdmin,
  source = 'active',
  enabled: isSourceEnabled = true,
}: UseWarehouseCatalogOptions) => {
  const enabled = Boolean(userId) && isSourceEnabled;
  const resetKey = `${userId ?? ''}|${isAdmin ? 'admin' : 'staff'}|${source}|${enabled ? 'on' : 'off'}`;

  const [state, setState] = useState<CatalogState>(() => initialState(enabled));
  const controllerRef = useRef<AbortController | null>(null);
  const isMountedRef = useRef<boolean>(true);

  const [prevResetKey, setPrevResetKey] = useState(resetKey);
  if (prevResetKey !== resetKey) {
    setPrevResetKey(resetKey);
    setState(initialState(enabled));
  }

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      controllerRef.current?.abort();
    };
  }, []);

  const load = useCallback(async (mode: CatalogLoadMode) => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const isCurrent = () =>
      isMountedRef.current && !controller.signal.aborted && controllerRef.current === controller;

    setState((prev) => ({
      catalog: mode === 'primary' ? null : prev.catalog,
      isLoading: mode === 'primary' || prev.catalog === null,
      // A retry keeps the banner (with a disabled button) until the result is known
      error: mode === 'retry' ? prev.error : null,
    }));

    let succeeded = false;
    try {
      const res =
        source === 'archived'
          ? await warehouseApi.listArchivedCatalog(controller.signal)
          : await warehouseApi.listCatalog(controller.signal);
      if (!isCurrent()) return;
      if (res.success) {
        succeeded = true;
        setState({ catalog: res.data, isLoading: false, error: null });
      } else {
        setState((prev) => ({ ...prev, isLoading: false, error: res.error.message }));
      }
    } catch (err: unknown) {
      if ((err instanceof DOMException && err.name === 'AbortError') || !isCurrent()) return;
      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: 'Не удалось загрузить каталог товаров. Проверьте подключение к сети.',
      }));
    } finally {
      if (controllerRef.current === controller && isCurrent()) {
        controllerRef.current = null;
      }
      if (mode === 'retry' && isMountedRef.current && !controller.signal.aborted) {
        requestAnimationFrame(() => {
          if (!isMountedRef.current) return;
          const active = document.activeElement;
          const isFocusLost =
            !active ||
            active === document.body ||
            Boolean(active.closest?.(CATALOG_RETRY_BUTTON_SELECTOR));
          if (!isFocusLost) return;
          if (succeeded) {
            restoreFocusWithFallback(null, CATALOG_SUCCESS_FOCUS_SELECTOR);
            return;
          }
          const retryBtn = document.querySelector<HTMLButtonElement>(CATALOG_RETRY_BUTTON_SELECTOR);
          if (retryBtn && !retryBtn.disabled) retryBtn.focus();
        });
      }
    }
  }, [source]);

  // Primary load per user / role; the cleanup aborts it on leave or switch
  useEffect(() => {
    if (!enabled) return;
    // Started from a microtask: the state is already reset to "loading" during render
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (!cancelled && isMountedRef.current) void load('primary');
    });
    return () => {
      cancelled = true;
      controllerRef.current?.abort();
      controllerRef.current = null;
    };
  }, [enabled, resetKey, load]);

  /** Applies an admin mutation result immediately (only to a loaded admin catalog). */
  const applyProduct = useCallback((product: WarehouseCatalogProduct, mode: 'upsert' | 'remove') => {
    setState((prev) => {
      if (!prev.catalog || prev.catalog.role !== 'admin') return prev;
      const others = prev.catalog.products.filter((p) => p.id !== product.id);
      const products =
        mode === 'remove'
          ? others
          : prev.catalog.products.some((p) => p.id === product.id)
            ? prev.catalog.products.map((p) => (p.id === product.id ? product : p))
            : [product, ...others];
      return { ...prev, catalog: { ...prev.catalog, products } };
    });
  }, []);

  const retry = useCallback(() => {
    void load('retry');
  }, [load]);

  const refresh = useCallback(() => {
    void load('background');
  }, [load]);

  return { ...state, retry, refresh, applyProduct };
};
