import { useState, useEffect, useCallback, useRef } from 'react';
import type { WarehouseCatalogProduct, WarehouseMovementView } from '../../../types';
import { warehouseApi } from '../../../api/warehouse';

interface MovementsState {
  product: WarehouseCatalogProduct | null;
  /** Only a COMPLETE history (all pages) is ever shown. */
  movements: WarehouseMovementView[];
  isLoading: boolean;
  error: string | null;
}

const CLOSED: MovementsState = { product: null, movements: [], isLoading: false, error: null };

/**
 * Movements of one product via the role-aware rpc_list_product_movements.
 * One AbortController: closing the modal, opening another product, leaving the page or a
 * user / role switch (resetKey) aborts the request and closes the modal.
 */
export const useProductMovements = (resetKey: string) => {
  const [state, setState] = useState<MovementsState>(CLOSED);
  const controllerRef = useRef<AbortController | null>(null);
  const isMountedRef = useRef<boolean>(true);

  const [prevResetKey, setPrevResetKey] = useState(resetKey);
  if (prevResetKey !== resetKey) {
    setPrevResetKey(resetKey);
    setState(CLOSED);
  }

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      controllerRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    return () => {
      controllerRef.current?.abort();
      controllerRef.current = null;
    };
  }, [resetKey]);

  const load = useCallback(async (product: WarehouseCatalogProduct) => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const isCurrent = () =>
      isMountedRef.current && !controller.signal.aborted && controllerRef.current === controller;

    setState({ product, movements: [], isLoading: true, error: null });

    try {
      const res = await warehouseApi.listProductMovements(product.id, controller.signal);
      if (!isCurrent()) return;
      setState(
        res.success
          ? { product, movements: res.data.movements, isLoading: false, error: null }
          : { product, movements: [], isLoading: false, error: res.error.message }
      );
    } catch (err: unknown) {
      if ((err instanceof DOMException && err.name === 'AbortError') || !isCurrent()) return;
      setState({ product, movements: [], isLoading: false, error: 'Ошибка при загрузке истории движений.' });
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
    }
  }, []);

  const open = useCallback((product: WarehouseCatalogProduct) => {
    void load(product);
  }, [load]);

  const close = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setState(CLOSED);
  }, []);

  const productRef = useRef<WarehouseCatalogProduct | null>(null);
  useEffect(() => {
    productRef.current = state.product;
  }, [state.product]);

  const retry = useCallback(() => {
    const product = productRef.current;
    if (product) void load(product);
  }, [load]);

  /** Reloads the history if the modal is open for this product (e.g. after a stock adjustment). */
  const reloadIfOpen = useCallback((product: WarehouseCatalogProduct) => {
    if (productRef.current?.id === product.id) void load(product);
  }, [load]);

  return { ...state, open, close, retry, reloadIfOpen };
};
