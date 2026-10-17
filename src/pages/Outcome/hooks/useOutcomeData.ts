import { useState, useEffect, useCallback, useRef } from 'react';
import type { OutcomeDocument, Product } from '../../../types';
import { outcomeApi } from '../../../api/outcome';
import { warehouseApi } from '../../../api/warehouse';
import { restoreFocusWithFallback } from '../../../utils/focusUtils';

interface UseOutcomeDataOptions {
  userId: string | null;
  isAnyModalOpen: () => boolean;
  /**
   * Called with freshly loaded documents.
   * Returns true when a pending operation was confirmed (focus is then returned to the add button).
   */
  onDocumentsLoaded?: (documents: OutcomeDocument[]) => boolean;
}

/**
 * Loads outcome documents and active catalog products from Supabase.
 * - Each loader cancels its previous in-flight request (AbortController) and ignores stale responses.
 * - State is reset when the authenticated user changes.
 * - Retry handlers restore focus to the retry button on failure or to the add button on success.
 */
export const useOutcomeData = ({
  userId,
  isAnyModalOpen,
  onDocumentsLoaded,
}: UseOutcomeDataOptions) => {
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

  // Reset state on user switch or logout
  const [prevUserId, setPrevUserId] = useState<string | null>(userId);
  if (prevUserId !== userId) {
    setPrevUserId(userId);
    setDocuments([]);
    setIsLoadingDocuments(Boolean(userId));
    setDocumentsLoadError(null);
    setIsDocumentsTruncated(false);
    setProducts([]);
    setIsLoadingProducts(Boolean(userId));
    setProductsLoadError(null);
  }

  const loadDocuments = useCallback(async (isRetry = false) => {
    if (!userId) return;

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
        documentsAbortControllerRef.current !== controller
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
  }, [userId, isAnyModalOpen]);

  const loadProducts = useCallback(async (isRetry = false) => {
    if (!userId) return;

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
      const res = await warehouseApi.fetchProducts(controller.signal);
      if (
        !isMountedRef.current ||
        controller.signal.aborted ||
        productsAbortControllerRef.current !== controller
      ) {
        return;
      }

      if (res.success) {
        resSuccess = true;
        setProductsLoadError(null);
        setProducts(res.data);
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
  }, [userId, isAnyModalOpen]);

  const reloadAll = useCallback(async () => {
    await Promise.all([loadDocuments(), loadProducts()]);
  }, [loadDocuments, loadProducts]);

  // Lifecycle & data loading
  useEffect(() => {
    isMountedRef.current = true;
    if (!userId) return;

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
  }, [userId, loadDocuments, loadProducts]);

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
