import { supabase } from '../../lib/supabase';
import type { Database } from '../../types/database.types';
import type {
  Product,
  WarehouseMovement,
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
