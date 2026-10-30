import { useState, useCallback, useEffect, useRef } from 'react';
import type {
  WarehouseCatalogProduct,
  WarehouseRestoreResult,
  WarehouseViewMode,
} from '../../../types';
import { warehouseApi } from '../../../api/warehouse';
import { useWarehouseCatalog } from './useWarehouseCatalog';

interface UseWarehouseArchiveOptions {
  userId: string | null;
  isAdmin: boolean;
  /** Changes on a user / role switch: the archive view, its data and the dialog are dropped. */
  accessKey: string;
  /** The client role is admin and the server did not answer the active catalog as a cashier. */
  canUseArchive: boolean;
  /** Called once per successful restore of the current user / role (after the archive row is removed). */
  onRestored: (result: WarehouseRestoreResult) => void;
}

/**
 * Admin-only archive view of the warehouse page:
 * - the archive (rpc_list_archived_products) is loaded only while the view is open and is
 *   aborted / cleared when it closes or the user / role changes;
 * - restore goes through rpc_restore_product after a confirmation; a result that arrives after
 *   a user / role switch or after leaving the page is ignored.
 * NOTE: hiding UI is not a protection — the server rejects non-admin callers (42501).
 */
export const useWarehouseArchive = ({
  userId,
  isAdmin,
  accessKey,
  canUseArchive,
  onRestored,
}: UseWarehouseArchiveOptions) => {
  const [viewMode, setViewMode] = useState<WarehouseViewMode>('active');
  const [productToRestore, setProductToRestore] = useState<WarehouseCatalogProduct | null>(null);
  const [isRestoreSubmitting, setIsRestoreSubmitting] = useState<boolean>(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);

  const [prevAccessKey, setPrevAccessKey] = useState(accessKey);
  if (prevAccessKey !== accessKey) {
    setPrevAccessKey(accessKey);
    setViewMode('active');
    setProductToRestore(null);
    setRestoreError(null);
    setIsRestoreSubmitting(false);
  }

  const isArchiveMode = canUseArchive && viewMode === 'archived';

  const archive = useWarehouseCatalog({
    userId,
    isAdmin,
    source: 'archived',
    enabled: isArchiveMode,
  });
  const { applyProduct: applyArchiveProduct, refresh: refreshArchive } = archive;

  const accessKeyRef = useRef(accessKey);
  const isMountedRef = useRef<boolean>(true);
  useEffect(() => {
    accessKeyRef.current = accessKey;
  }, [accessKey]);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const toggleViewMode = useCallback(() => {
    setViewMode((prev) => (prev === 'archived' ? 'active' : 'archived'));
    setProductToRestore(null);
    setRestoreError(null);
  }, []);

  const requestRestore = useCallback(
    (product: WarehouseCatalogProduct) => {
      if (!isArchiveMode || !product.isArchived) return;
      setRestoreError(null);
      setProductToRestore(product);
    },
    [isArchiveMode]
  );

  const cancelRestore = useCallback(() => {
    setProductToRestore(null);
    setRestoreError(null);
  }, []);

  const confirmRestore = useCallback(
    async (product: WarehouseCatalogProduct) => {
      if (!isArchiveMode) return;
      const requestKey = accessKeyRef.current;
      const isCurrent = () => isMountedRef.current && accessKeyRef.current === requestKey;

      setIsRestoreSubmitting(true);
      setRestoreError(null);
      try {
        const res = await warehouseApi.restoreProduct(product.id);
        if (!isCurrent()) return;

        if (!res.success) {
          setProductToRestore((current) => {
            if (current?.id === product.id) setRestoreError(res.error.message);
            return current;
          });
          return;
        }

        applyArchiveProduct(product, 'remove');
        setProductToRestore((current) => (current?.id === product.id ? null : current));
        onRestored(res.data);
        refreshArchive();
      } catch {
        if (!isCurrent()) return;
        setProductToRestore((current) => {
          if (current?.id === product.id) {
            setRestoreError('Произошла ошибка при восстановлении товара.');
          }
          return current;
        });
      } finally {
        if (isCurrent()) setIsRestoreSubmitting(false);
      }
    },
    [isArchiveMode, applyArchiveProduct, refreshArchive, onRestored]
  );

  return {
    isArchiveMode,
    toggleViewMode,
    archive,
    productToRestore: isArchiveMode ? productToRestore : null,
    isRestoreSubmitting,
    restoreError,
    requestRestore,
    cancelRestore,
    confirmRestore,
  };
};
