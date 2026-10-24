import { useState, useEffect, useCallback, useRef } from 'react';
import type { OutcomeDocument, Product } from '../../../types';
import { outcomeApi, mapCatalogToOutcomeProducts } from '../../../api/outcome';
import { warehouseApi } from '../../../api/warehouse';
import { restoreFocusWithFallback } from '../../../utils/focusUtils';

interface UseOutcomeDataOptions {
  userId: string | null;
  /** Outcome is admin-only: nothing is loaded otherwise; a role change aborts and clears all data. */
  isAdmin: boolean;
  isAnyModalOpen: () => boolean;
  /**
   * Called with freshly loaded documents.
   * Returns true when a pending operation was confirmed (focus is then returned to the add button).
   */
  onDocumentsLoaded?: (documents: OutcomeDocument[]) => boolean;
}

const ADMIN_ONLY_CATALOG_MESSAGE =
  'Каталог списания доступен только администратору. Обновите страницу или войдите заново.';

/**
 * Loads outcome documents and active catalog products from Supabase.
 * - The catalog comes from the role-aware rpc_list_products (admin response with purchase prices,
 *   all keyset pages or nothing); a failed load never yields a partial catalog.
 * - Each loader cancels its previous in-flight request (AbortController) and ignores stale responses.
 * - State is reset (and requests aborted) when the authenticated user or the role changes;
 *   nothing is loaded for a non-admin.
 * - Retry handlers restore focus to the retry button on failure or to the add button on success.
 */
export const useOutcomeData = ({
  userId,
  isAdmin,
  isAnyModalOpen,
  onDocumentsLoaded,
}: UseOutcomeDataOptions) => {
  const enabled = Boolean(userId) && isAdmin;

  const [documents, setDocuments] = useState<OutcomeDocument[]>([]);
  const [isLoadingDocuments, setIsLoadingDocuments] = useState<boolean>(true);
  const [documentsLoadError, setDocumentsLoadError] = useState<string | null>(null);
  const [isDocumentsTruncated, setIsDocumentsTruncated] = useState<boolean>(false);

  const [products, setProducts] = useState<Product[]>([]);
  const [isLoadingProducts, setIsLoadingProducts] = useState<boolean>(true);
  const [productsLoadError, setProductsLoadError] = useState<string | null>(null);

  const documentsAbortControllerRef = useRef<AbortController | null>(null);
  const productsAbortControllerRef = useRef<AbortController | null>(null);
  const isMountedRef = useRef<boolean>(true);

  // Latest-callback ref: loaders always see the current handler without being recreated
  const onDocumentsLoadedRef = useRef(onDocumentsLoaded);
  useEffect(() => {
    onDocumentsLoadedRef.current = onDocumentsLoaded;
  }, [onDocumentsLoaded]);

  // Reset state on user switch, logout or role change: never keep data loaded under another role
  const resetKey = `${userId ?? ''}|${isAdmin ? 'admin' : 'staff'}`;
  // Latest access key: a load started under a previous user / role never applies its result
  const accessKeyRef = useRef(resetKey);
  useEffect(() => {
    accessKeyRef.current = resetKey;
  }, [resetKey]);
  const [prevResetKey, setPrevResetKey] = useState<string>(resetKey);
  if (prevResetKey !== resetKey) {
    setPrevResetKey(resetKey);
    setDocuments([]);
    setIsLoadingDocuments(enabled);
    setDocumentsLoadError(null);
    setIsDocumentsTruncated(false);
    setProducts([]);
    setIsLoadingProducts(enabled);
    setProductsLoadError(null);
  }

  const loadDocuments = useCallback(async (isRetry = false) => {
    if (!enabled) return;
    const requestAccessKey = `${userId ?? ''}|admin`;

    if (documentsAbortControllerRef.current) {
      documentsAbortControllerRef.current.abort();
    }
    const controller = new AbortController();
    documentsAbortControllerRef.current = controller;

    setIsLoadingDocuments(true);
    if (!isRetry) {
      setDocumentsLoadError(null);
    }
    let pendingConfirmed = false;
    let resSuccess = false;

    try {
      const res = await outcomeApi.fetchOutcomeDocuments(controller.signal);
      if (
        !isMountedRef.current ||
        controller.signal.aborted ||
        documentsAbortControllerRef.current !== controller ||
        accessKeyRef.current !== requestAccessKey
      ) {
        return;
      }

      if (res.success) {
        resSuccess = true;
        setDocumentsLoadError(null);
        setDocuments(res.data.documents);
        setIsDocumentsTruncated(res.data.isTruncated);
        pendingConfirmed = onDocumentsLoadedRef.current?.(res.data.documents) ?? false;
      } else {
        setDocumentsLoadError(res.error.message);
      }
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return;
      }
      if (
        !isMountedRef.current ||
        controller.signal.aborted ||
        documentsAbortControllerRef.current !== controller
      ) {
        return;
      }
      setDocumentsLoadError(
        'Не удалось загрузить документы списания. Проверьте подключение к сети.'
      );
    } finally {
      if (
        isMountedRef.current &&
        documentsAbortControllerRef.current === controller
      ) {
        setIsLoadingDocuments(false);
        if (pendingConfirmed) {
          requestAnimationFrame(() => {
            if (isMountedRef.current && !isAnyModalOpen()) {
              restoreFocusWithFallback(null, '[data-add-outcome-btn]');
            }
          });
        } else if (isRetry) {
          requestAnimationFrame(() => {
            if (!isMountedRef.current || isAnyModalOpen()) return;
            if (resSuccess) {
              restoreFocusWithFallback(null, '[data-add-outcome-btn]');
            } else {
              const retryBtn = document.querySelector<HTMLButtonElement>(
                '[data-retry-documents-btn]'
              );
              if (retryBtn && !retryBtn.disabled) {
                retryBtn.focus();
              } else {
                restoreFocusWithFallback(null, '[data-add-outcome-btn]');
              }
            }
          });
        }
      }
    }
  }, [enabled, userId, isAnyModalOpen]);

  const loadProducts = useCallback(async (isRetry = false) => {
    if (!enabled) return;

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

    try {
      // All pages or nothing: a failed / inconsistent page never yields a partial catalog
      const res = await warehouseApi.listCatalog(controller.signal);
      if (
        !isMountedRef.current ||
        controller.signal.aborted ||
        productsAbortControllerRef.current !== controller
      ) {
        return;
      }

      if (res.success) {
        const mapped = mapCatalogToOutcomeProducts(res.data);
        if (mapped) {
          resSuccess = true;
          setProductsLoadError(null);
          setProducts(mapped);
        } else {
          setProducts([]);
          setProductsLoadError(ADMIN_ONLY_CATALOG_MESSAGE);
        }
      } else {
        setProductsLoadError(res.error.message);
      }
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return;
      }
      if (
        !isMountedRef.current ||
        controller.signal.aborted ||
        productsAbortControllerRef.current !== controller
      ) {
        return;
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
              restoreFocusWithFallback(null, '[data-add-outcome-btn]');
            } else {
              const retryBtn = document.querySelector<HTMLButtonElement>(
                '[data-retry-products-btn]'
              );
              if (retryBtn && !retryBtn.disabled) {
                retryBtn.focus();
              } else {
                restoreFocusWithFallback(null, '[data-add-outcome-btn]');
              }
            }
          });
        }
      }
    }
  }, [enabled, isAnyModalOpen]);

  const reloadAll = useCallback(async () => {
    await Promise.all([loadDocuments(), loadProducts()]);
  }, [loadDocuments, loadProducts]);

  // Lifecycle & data loading; a user OR role change aborts everything and reloads
  useEffect(() => {
    isMountedRef.current = true;
    if (!enabled) return;

    void Promise.resolve().then(() => {
      if (isMountedRef.current) {
        loadDocuments();
        loadProducts();
      }
    });

    return () => {
      isMountedRef.current = false;
      if (documentsAbortControllerRef.current) {
        documentsAbortControllerRef.current.abort();
      }
      if (productsAbortControllerRef.current) {
        productsAbortControllerRef.current.abort();
      }
    };
  }, [enabled, resetKey, loadDocuments, loadProducts]);

  return {
    documents,
    isLoadingDocuments,
    documentsLoadError,
    isDocumentsTruncated,
    products,
    isLoadingProducts,
    productsLoadError,
    loadDocuments,
    loadProducts,
    reloadAll,
  };
};
