import { supabase } from '../../lib/supabase';
import type { Database } from '../../types/database.types';
import type {
  Product,
  WarehouseMovement,
  WarehouseCatalog,
  WarehouseCatalogProduct,
  WarehouseMovementsResult,
  WarehouseMovementView,
  CatalogAccessRole,
} from '../../types';
import { getCategoryLabel } from '../../utils/productUtils';
import {
  mapProductRowToProduct,
  mapStockMovementRowToMovement,
  mapCreateProductToRpcArgs,
  mapUpdateProductToRpcArgs,
} from './warehouseMappers';
import type {
  CreateProductInput,
  UpdateProductInput,
  AdjustStockInput,
  WarehouseApiResult,
} from '../../types';
import { mapWarehouseError } from './warehouseErrorMapper';
import {
  WarehouseCatalogDataError,
  isCursorBefore,
  mapCatalogPage,
  mapMovementsPage,
} from './warehouseCatalogMappers';
import type { MovementCursor } from './warehouseCatalogMappers';

/** Page size of the role-aware catalog / movement RPCs (server maximum, PostgREST max_rows). */
export const WAREHOUSE_RPC_PAGE_SIZE = 1000;
/** Hard stop against a server that never ends pagination. */
const MAX_RPC_PAGES = 1000;

const isAbortError = (err: unknown): boolean =>
  err instanceof DOMException && err.name === 'AbortError';

const dataError = (err: WarehouseCatalogDataError): WarehouseApiResult<never> => ({
  success: false,
  error: { message: err.message },
});

export type {
  CreateProductInput,
  UpdateProductInput,
  AdjustStockInput,
  WarehouseApiResult,
};

/**
 * Repository / API layer for Warehouse operations via Supabase.
 * - SELECT queries are read-only and enforce active user access.
 * - All mutations (create, update, adjust, archive) go strictly through
 *   transactional SECURITY DEFINER PostgreSQL RPCs.
 * - Direct INSERT, UPDATE, DELETE to tables are strictly avoided.
 */
export const warehouseApi = {
  /**
   * Fetches active (non-archived) products for the warehouse catalog.
   * Loads all records across pages using safe range chunking to prevent max_rows truncations.
   */
  async fetchProducts(signal?: AbortSignal): Promise<WarehouseApiResult<Product[]>> {
    try {
      const allRows: Database['public']['Tables']['products']['Row'][] = [];
      const batchSize = 1000;
      let from = 0;
      let hasMore = true;

      while (hasMore) {
        let query = supabase
          .from('products')
          .select('*')
          .eq('is_archived', false)
          .order('name', { ascending: true })
          .order('id', { ascending: true })
          .range(from, from + batchSize - 1);

        if (signal) {
          query = query.abortSignal(signal);
        }

        const { data, error } = await query;

        if (error) {
          return { success: false, error: mapWarehouseError(error) };
        }

        const rows = data ?? [];
        allRows.push(...rows);

        if (rows.length < batchSize) {
          hasMore = false;
        } else {
          from += batchSize;
        }
      }

      const products = allRows.map(mapProductRowToProduct);
      return { success: true, data: products };
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw err;
      }
      return { success: false, error: mapWarehouseError(err) };
    }
  },

  /**
   * Fetches stock movements for a specific product.
   * Sorted chronologically (occurred_at DESC, created_at DESC, id DESC).
   * Safe chunked retrieval preventing 1000 row limits.
   */
  async fetchProductMovements(
    productId: string,
    signal?: AbortSignal
  ): Promise<WarehouseApiResult<WarehouseMovement[]>> {
    try {
      const allRows: Database['public']['Tables']['stock_movements']['Row'][] = [];
      const batchSize = 1000;
      let from = 0;
      let hasMore = true;

      while (hasMore) {
        let query = supabase
          .from('stock_movements')
          .select('*')
          .eq('product_id', productId)
          .order('occurred_at', { ascending: false })
          .order('created_at', { ascending: false })
          .order('id', { ascending: false })
          .range(from, from + batchSize - 1);

        if (signal) {
          query = query.abortSignal(signal);
        }

        const { data, error } = await query;

        if (error) {
          return { success: false, error: mapWarehouseError(error) };
        }

        const rows = data ?? [];
        allRows.push(...rows);

        if (rows.length < batchSize) {
          hasMore = false;
        } else {
          from += batchSize;
        }
      }

      const movements = allRows.map(mapStockMovementRowToMovement);
      return { success: true, data: movements };
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw err;
      }
      return { success: false, error: mapWarehouseError(err) };
    }
  },

  /**
   * Role-aware warehouse catalog via rpc_list_products (admin: full rows; cashier: no purchase
   * price / description / timestamps). Loads ALL pages by keyset cursor (id ASC):
   * - every page is strictly validated (exact field set of the returned role, ranges, order);
   * - the role must stay the same across pages, the cursor must strictly increase, ids are unique;
   * - all-or-nothing: any error returns a failure and no partial catalog.
   * AbortError is re-thrown so callers can ignore cancelled loads.
   */
  async listCatalog(signal: AbortSignal): Promise<WarehouseApiResult<WarehouseCatalog>> {
    try {
      const products: WarehouseCatalogProduct[] = [];
      const seenIds = new Set<string>();
      let role: CatalogAccessRole | null = null;
      let afterId: string | null = null;

      for (let pageIndex = 0; ; pageIndex++) {
        if (pageIndex >= MAX_RPC_PAGES) throw new WarehouseCatalogDataError();
        const args: Database['public']['Functions']['rpc_list_products']['Args'] = {
          p_include_archived: false,
          p_limit: WAREHOUSE_RPC_PAGE_SIZE,
        };
        if (afterId !== null) args.p_after_id = afterId;

        const { data, error } = await supabase.rpc('rpc_list_products', args).abortSignal(signal);
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
        if (error) return { success: false, error: mapWarehouseError(error) };

        const page = mapCatalogPage(data, WAREHOUSE_RPC_PAGE_SIZE);
        if (role !== null && page.role !== role) throw new WarehouseCatalogDataError();
        role = page.role;

        for (const product of page.products) {
          // Keyset order: every row must follow the previous cursor; a repeat means a broken page
          if (seenIds.has(product.id) || (afterId !== null && !(product.id > afterId))) {
            throw new WarehouseCatalogDataError();
          }
          seenIds.add(product.id);
          products.push(product);
        }

        if (page.nextAfterId === null) break;
        afterId = page.nextAfterId;
      }

      if (role === null) throw new WarehouseCatalogDataError();
      // Archived rows are never requested; a server returning one is inconsistent
      if (products.some((p) => p.isArchived)) throw new WarehouseCatalogDataError();
      return { success: true, data: { role, products } };
    } catch (err: unknown) {
      if (isAbortError(err)) throw err;
      if (err instanceof WarehouseCatalogDataError) return dataError(err);
      return { success: false, error: mapWarehouseError(err) };
    }
  },

  /**
   * Role-aware movements of one product via rpc_list_product_movements (cashier rows carry no
   * note / responsible person). Loads ALL pages; the server next_cursor strings are passed back
   * unchanged (no Date conversion). Cursors must strictly decrease, ids are unique, the role is
   * constant; any error returns a failure without partial data.
   */
  async listProductMovements(
    productId: string,
    signal: AbortSignal
  ): Promise<WarehouseApiResult<WarehouseMovementsResult>> {
    try {
      const movements: WarehouseMovementView[] = [];
      const seenIds = new Set<string>();
      let role: CatalogAccessRole | null = null;
      let cursor: MovementCursor | null = null;
      let lastMicros: number | null = null;

      for (let pageIndex = 0; ; pageIndex++) {
        if (pageIndex >= MAX_RPC_PAGES) throw new WarehouseCatalogDataError();
        const args: Database['public']['Functions']['rpc_list_product_movements']['Args'] = {
          p_product_id: productId,
          p_limit: WAREHOUSE_RPC_PAGE_SIZE,
        };
        if (cursor !== null) {
          args.p_after_occurred_at = cursor.occurredAt;
          args.p_after_created_at = cursor.createdAt;
          args.p_after_id = cursor.id;
        }

        const { data, error } = await supabase
          .rpc('rpc_list_product_movements', args)
          .abortSignal(signal);
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
        if (error) return { success: false, error: mapWarehouseError(error) };

        const page = mapMovementsPage(data, WAREHOUSE_RPC_PAGE_SIZE);
        if (role !== null && page.role !== role) throw new WarehouseCatalogDataError();
        role = page.role;

        // The first row of a next page may not be newer than the last row of the previous one
        const first = page.order[0];
        if (first && lastMicros !== null && first.occurredMicros > lastMicros) {
          throw new WarehouseCatalogDataError();
        }
        for (const movement of page.movements) {
          if (seenIds.has(movement.id)) throw new WarehouseCatalogDataError();
          seenIds.add(movement.id);
          movements.push(movement);
        }
        const last = page.order[page.order.length - 1];
        if (last) lastMicros = last.occurredMicros;

        if (page.nextCursor === null) break;
        if (cursor !== null && !isCursorBefore(page.nextCursor, cursor)) {
          throw new WarehouseCatalogDataError();
        }
        cursor = page.nextCursor;
      }

      if (role === null) throw new WarehouseCatalogDataError();
      return { success: true, data: { role, movements } };
    } catch (err: unknown) {
      if (isAbortError(err)) throw err;
      if (err instanceof WarehouseCatalogDataError) return dataError(err);
      return { success: false, error: mapWarehouseError(err) };
    }
  },

  /**
   * Creates a new product via rpc_create_product.
   */
  async createProduct(input: CreateProductInput): Promise<WarehouseApiResult<Product>> {
    try {
      const categoryLabel = getCategoryLabel(input.category);
      const rpcArgs = mapCreateProductToRpcArgs({
        ...input,
        categoryLabel,
      });

      const { data, error } = await supabase.rpc('rpc_create_product', rpcArgs);

      if (error) {
        return { success: false, error: mapWarehouseError(error) };
      }

      if (!data) {
        return {
          success: false,
          error: { message: 'Сервер не вернул данные созданного товара.' },
        };
      }

      const product = mapProductRowToProduct(data);
      return { success: true, data: product };
    } catch (err: unknown) {
      return { success: false, error: mapWarehouseError(err) };
    }
  },

  /**
   * Updates product metadata & prices via rpc_update_product (stock is never changed here).
   */
  async updateProduct(
    productId: string,
    input: UpdateProductInput
  ): Promise<WarehouseApiResult<Product>> {
    try {
      const categoryLabel = getCategoryLabel(input.category);
      const rpcArgs = mapUpdateProductToRpcArgs(productId, {
        ...input,
        categoryLabel,
      });

      const { data, error } = await supabase.rpc('rpc_update_product', rpcArgs);

      if (error) {
        return { success: false, error: mapWarehouseError(error) };
      }

      if (!data) {
        return {
          success: false,
          error: { message: 'Сервер не вернул данные обновлённого товара.' },
        };
      }

      const product = mapProductRowToProduct(data);
      return { success: true, data: product };
    } catch (err: unknown) {
      return { success: false, error: mapWarehouseError(err) };
    }
  },

  /**
   * Adjusts stock via rpc_adjust_product_stock.
   */
  async adjustStock(input: AdjustStockInput): Promise<WarehouseApiResult<Product>> {
    try {
      const cleanReason = input.reason.trim();
      const safeStock = Math.max(0, Math.floor(input.newStock));

      const { data, error } = await supabase.rpc('rpc_adjust_product_stock', {
        p_product_id: input.productId,
        p_new_stock: safeStock,
        p_reason: cleanReason,
      });

      if (error) {
        return { success: false, error: mapWarehouseError(error) };
      }

      if (!data) {
        return {
          success: false,
          error: { message: 'Сервер не вернул данные товара после корректировки.' },
        };
      }

      const product = mapProductRowToProduct(data);
      return { success: true, data: product };
    } catch (err: unknown) {
      return { success: false, error: mapWarehouseError(err) };
    }
  },

  /**
   * Archives or unarchives product via rpc_archive_product.
   */
  async archiveProduct(
    productId: string,
    isArchived: boolean = true
  ): Promise<WarehouseApiResult<Product>> {
    try {
      const { data, error } = await supabase.rpc('rpc_archive_product', {
        p_product_id: productId,
        p_is_archived: isArchived,
      });

      if (error) {
        return { success: false, error: mapWarehouseError(error) };
      }

      if (!data) {
        return {
          success: false,
          error: { message: 'Сервер не вернул данные после архивации товара.' },
        };
      }

      const product = mapProductRowToProduct(data);
      return { success: true, data: product };
    } catch (err: unknown) {
      return { success: false, error: mapWarehouseError(err) };
    }
  },
};
