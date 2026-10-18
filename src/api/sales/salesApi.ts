import { supabase } from '../../lib/supabase';
import type {
  CreateSaleInput,
  CreateSaleResult,
  FetchSalesOptions,
  FetchSalesResult,
  HistoricalPriceResult,
  Product,
  Sale,
  SaleApiResult,
} from '../../types';
import { resolveHistoricalPurchasePrices } from '../../utils/outcomePriceHistory';
import { signedMinorToAmount } from '../../utils/saleMinorCalculations';
import { fetchPriceHistoryPoints } from '../shared/priceHistoryQuery';
import { mapSaleFormToRpcArgs, mapSaleRowToSale } from './salesMappers';
import { mapSaleError } from './salesErrorMapper';

/**
 * Safe upper limit of receipts loaded into client memory for search, filters and statistics.
 * When reached, `isTruncated` is reported and the UI warns the user.
 */
export const DEFAULT_SALES_FETCH_LIMIT = 5000;

const BATCH_SIZE = 1000;

/** Embedded select: one request per batch returns receipts with all their lines (no N+1). */
const SALE_WITH_ITEMS_SELECT = '*, items:sale_items(*)';

const isAbortError = (err: unknown): boolean =>
  err instanceof DOMException && err.name === 'AbortError';

const readSafeInteger = (value: unknown): number | null =>
  typeof value === 'number' && Number.isSafeInteger(value) ? value : null;

/**
 * Parses the jsonb returned by rpc_create_sale with runtime guards (no type assertions).
 */
const parseCreateSaleResponse = (data: unknown): CreateSaleResult | null => {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const payload = data as Record<string, unknown>;

  const id = payload.id;
  const receiptNumber = payload.receipt_number;
  const totalMinor = readSafeInteger(payload.total_minor);
  const profitMinor = readSafeInteger(payload.profit_minor);
  const changeMinor = payload.change_minor === null ? null : readSafeInteger(payload.change_minor);
  const itemsCount = readSafeInteger(payload.items_count);

  if (typeof id !== 'string' || typeof receiptNumber !== 'string' || totalMinor === null || profitMinor === null) {
    return null;
  }

  return {
    id,
    receiptNumber,
    totalAmount: signedMinorToAmount(totalMinor),
    profitAmount: signedMinorToAmount(profitMinor),
    changeAmount: changeMinor === null ? null : signedMinorToAmount(changeMinor),
    itemsCount: itemsCount ?? 0,
  };
};

/**
 * Repository / API layer for Sales via Supabase.
 * - SELECT queries are read-only; receipts embed their lines (sale_items) — no N+1.
 * - Sales are created ONLY through the transactional RPC `rpc_create_sale`.
 * - Direct INSERT/UPDATE/DELETE on sales, sale_items, products or stock_movements is prohibited
 *   (and blocked by grants/RLS).
 */
export const salesApi = {
  /**
   * Loads receipts ordered by sold_at DESC, created_at DESC, id DESC in PostgREST-safe batches.
   * Optional bounds: soldFrom (inclusive), soldTo (inclusive) and soldBefore (exclusive) —
   * Sales History loads calendar ranges as [soldFrom, soldBefore).
   * Receipts are de-duplicated by id: a sale inserted between batches shifts OFFSET pagination.
   */
  async fetchSales(options: FetchSalesOptions = {}): Promise<SaleApiResult<FetchSalesResult>> {
    const { signal, limit = DEFAULT_SALES_FETCH_LIMIT, soldFrom, soldTo, soldBefore } = options;

    try {
      const sales: Sale[] = [];
      const seenIds = new Set<string>();
      let from = 0;
      let hasMore = true;

      while (hasMore && sales.length < limit) {
        const batchLimit = Math.min(BATCH_SIZE, limit - sales.length);

        let query = supabase
          .from('sales')
          .select(SALE_WITH_ITEMS_SELECT)
          .order('sold_at', { ascending: false })
          .order('created_at', { ascending: false })
          .order('id', { ascending: false })
          .range(from, from + batchLimit - 1);

        if (soldFrom) query = query.gte('sold_at', soldFrom);
        if (soldTo) query = query.lte('sold_at', soldTo);
        if (soldBefore) query = query.lt('sold_at', soldBefore);
        if (signal) query = query.abortSignal(signal);

        const { data, error, status } = await query;

        if (error) {
          return { success: false, error: mapSaleError({ ...error, status }) };
        }

        const rows = data ?? [];
        for (const row of rows) {
          if (!seenIds.has(row.id)) {
            seenIds.add(row.id);
            sales.push(mapSaleRowToSale(row));
          }
        }

        if (rows.length < batchLimit) {
          hasMore = false;
        } else {
          from += rows.length;
        }
      }

      return {
        success: true,
        data: {
          sales,
          isTruncated: hasMore && sales.length >= limit,
          totalFetched: sales.length,
        },
      };
    } catch (err: unknown) {
      if (isAbortError(err)) throw err;
      return { success: false, error: mapSaleError(err) };
    }
  },

  /**
   * Lightweight existence probe (`id`, limit 1): distinguishes "no sales at all"
   * from "nothing matches the selected period".
   */
  async hasAnySales(signal?: AbortSignal): Promise<SaleApiResult<boolean>> {
    try {
      let query = supabase.from('sales').select('id').limit(1);
      if (signal) query = query.abortSignal(signal);

      const { data, error, status } = await query;

      if (error) {
        return { success: false, error: mapSaleError({ ...error, status }) };
      }

      return { success: true, data: (data ?? []).length > 0 };
    } catch (err: unknown) {
      if (isAbortError(err)) throw err;
      return { success: false, error: mapSaleError(err) };
    }
  },

  /**
   * Loads one receipt with its lines by UUID. Returns data: null when it does not exist
   * (used to verify a pending, unconfirmed sale).
   */
  async fetchSaleById(saleId: string, signal?: AbortSignal): Promise<SaleApiResult<Sale | null>> {
    try {
      let query = supabase.from('sales').select(SALE_WITH_ITEMS_SELECT).eq('id', saleId);
      if (signal) query = query.abortSignal(signal);

      const { data, error, status } = await query.maybeSingle();

      if (error) {
        return { success: false, error: mapSaleError({ ...error, status }) };
      }

      return { success: true, data: data ? mapSaleRowToSale(data) : null };
    } catch (err: unknown) {
      if (isAbortError(err)) throw err;
      return { success: false, error: mapSaleError(err) };
    }
  },

  /**
   * Conducts a sale atomically through rpc_create_sale (stock decrement, sale movements,
   * historical cost snapshot). `input.id` is the mandatory idempotency UUID (`p_id`):
   * repeating the call with the same id returns the already conducted receipt.
   */
  async createSale(input: CreateSaleInput): Promise<SaleApiResult<CreateSaleResult>> {
    try {
      // Throws SaleValidationError before any network call when input is invalid
      const rpcArgs = mapSaleFormToRpcArgs(input);

      const { data, error, status } = await supabase.rpc('rpc_create_sale', rpcArgs);

      if (error) {
        // Unique violation on the same idempotency key: recover the already conducted receipt
        if (error.code === '23505') {
          const existing = await salesApi.fetchSaleById(input.id);
          if (existing.success && existing.data) {
            return {
              success: true,
              data: {
                id: existing.data.id,
                receiptNumber: existing.data.receiptNumber,
                totalAmount: existing.data.totalAmount,
                profitAmount: existing.data.profitAmount,
                changeAmount: existing.data.changeAmount ?? null,
                itemsCount: existing.data.items.length,
              },
            };
          }
        }
        return { success: false, error: mapSaleError({ ...error, status }) };
      }

      const parsed = parseCreateSaleResponse(data);
      if (!parsed) {
        return {
          success: false,
          error: {
            kind: 'network',
            message: 'Некорректный ответ сервера при проведении продажи. Результат не подтверждён — проверьте статус чека.',
          },
        };
      }

      return { success: true, data: parsed };
    } catch (err: unknown) {
      return { success: false, error: mapSaleError(err) };
    }
  },

  /**
   * Effective historical purchase prices at the sale date, resolved exactly like rpc_create_sale.
   * Display / bounds-check only: the server takes the authoritative cost snapshot.
   */
  async fetchHistoricalPurchasePrices(
    productIds: string[],
    soldAt: string,
    activeProducts: Product[],
    signal?: AbortSignal
  ): Promise<SaleApiResult<Record<string, HistoricalPriceResult>>> {
    try {
      const uniqueIds = Array.from(new Set(productIds.filter(Boolean)));
      if (uniqueIds.length === 0) {
        return { success: true, data: {} };
      }

      const historyRes = await fetchPriceHistoryPoints(uniqueIds, signal);
      if (!historyRes.success) {
        return { success: false, error: mapSaleError(historyRes.error) };
      }

      return {
        success: true,
        data: resolveHistoricalPurchasePrices(uniqueIds, historyRes.rows, soldAt, activeProducts),
      };
    } catch (err: unknown) {
      if (isAbortError(err)) throw err;
      return { success: false, error: mapSaleError(err) };
    }
  },
};
