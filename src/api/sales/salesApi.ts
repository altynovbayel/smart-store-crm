import { supabase } from '../../lib/supabase';
import type {
  CreateSaleInput,
  CreateSaleResult,
  FetchSalesOptions,
  FetchSalesResult,
  ListSalesRpcArgs,
  Sale,
  SaleApiResult,
  SalesRpcRole,
} from '../../types';
import { SALES_RPC_MAX_PAGE_SIZE } from '../../types';
import { signedMinorToAmount } from '../../utils/saleMinorCalculations';
import { mapSaleFormToRpcArgs } from './salesMappers';
import { mapSaleError } from './salesErrorMapper';
import {
  SalesDataError,
  isAfterInDescOrder,
  mapGetSaleResponse,
  mapSalesPage,
  type SalesCursor,
} from './salesRpcMappers';

/**
 * Safe upper limit of receipts loaded into client memory for search, filters and statistics.
 * When reached, `isTruncated` is reported and the UI warns the user.
 */
export const DEFAULT_SALES_FETCH_LIMIT = 5000;

const isAbortError = (err: unknown): boolean =>
  err instanceof DOMException && err.name === 'AbortError';

const throwIfAborted = (signal?: AbortSignal): void => {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
};

const dataError = (err: SalesDataError): SaleApiResult<never> => ({
  success: false,
  error: { kind: 'internal', message: err.message },
});

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
  // profit_minor (if the server still returns it) is deliberately ignored: the client never needs it
  const changeMinor = payload.change_minor === null ? null : readSafeInteger(payload.change_minor);
  const itemsCount = readSafeInteger(payload.items_count);

  if (typeof id !== 'string' || typeof receiptNumber !== 'string' || totalMinor === null) {
    return null;
  }

  return {
    id,
    receiptNumber,
    totalAmount: signedMinorToAmount(totalMinor),
    changeAmount: changeMinor === null ? null : signedMinorToAmount(changeMinor),
    itemsCount: itemsCount ?? 0,
  };
};

/**
 * Repository / API layer for Sales via Supabase.
 * - Receipts are read ONLY through the role-aware RPCs rpc_list_sales / rpc_get_sale /
 *   rpc_has_any_sales (no direct SELECT on sales / sale_items); a cashier payload never carries
 *   profit or cost data and any such field is rejected as a load error.
 * - Sales are created ONLY through the transactional RPC `rpc_create_sale`.
 * - Direct INSERT/UPDATE/DELETE on sales, sale_items, products or stock_movements is prohibited
 *   (and blocked by grants/RLS).
 */
export const salesApi = {
  /**
   * Loads receipts (sold_at, created_at, id DESC) via rpc_list_sales in keyset pages of <= 200.
   * Optional bounds: soldFrom (inclusive) and soldBefore (exclusive) — Sales History loads
   * calendar ranges as [soldFrom, soldBefore).
   * - next_cursor strings are passed back UNCHANGED (microseconds, no Date round-trip);
   * - every page is strictly validated (exact field set of the returned role, order, totals);
   * - the role must stay the same across pages, the cursor must strictly advance and every row
   *   must lie after the previous cursor; a repeated id is an error (no silent de-duplication);
   * - all-or-nothing: any error returns a failure and no partial list.
   * isTruncated: the safety limit was reached while the server still had older receipts.
   */
  async fetchSales(options: FetchSalesOptions = {}): Promise<SaleApiResult<FetchSalesResult>> {
    const { signal, limit = DEFAULT_SALES_FETCH_LIMIT, soldFrom, soldBefore } = options;

    try {
      const sales: Sale[] = [];
      const seenIds = new Set<string>();
      let role: SalesRpcRole | null = null;
      let cursor: SalesCursor | null = null;
      let cursorKey: { soldMicros: number; createdMicros: number; id: string } | null = null;
      let hasMore = true;

      while (hasMore && sales.length < limit) {
        const pageLimit = Math.min(SALES_RPC_MAX_PAGE_SIZE, limit - sales.length);
        const args: ListSalesRpcArgs = { p_limit: pageLimit };
        if (soldFrom) args.p_sold_from = soldFrom;
        if (soldBefore) args.p_sold_before = soldBefore;
        if (cursor) {
          args.p_after_sold_at = cursor.soldAt;
          args.p_after_created_at = cursor.createdAt;
          args.p_after_id = cursor.id;
        }

        let request = supabase.rpc('rpc_list_sales', args);
        if (signal) request = request.abortSignal(signal);
        const { data, error, status } = await request;
        throwIfAborted(signal);

        if (error) {
          return { success: false, error: mapSaleError({ ...error, status }) };
        }

        const page = mapSalesPage(data, pageLimit);
        if (role !== null && page.role !== role) throw new SalesDataError();
        role = page.role;

        for (let i = 0; i < page.sales.length; i++) {
          const sale = page.sales[i];
          if (seenIds.has(sale.id)) throw new SalesDataError();
          if (cursorKey && !isAfterInDescOrder(page.keys[i], cursorKey)) throw new SalesDataError();
          seenIds.add(sale.id);
          sales.push(sale);
        }

        if (page.nextCursor === null || page.nextCursorKey === null) {
          hasMore = false;
        } else {
          if (cursorKey && !isAfterInDescOrder(page.nextCursorKey, cursorKey)) throw new SalesDataError();
          cursor = page.nextCursor;
          cursorKey = page.nextCursorKey;
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
      if (err instanceof SalesDataError) return dataError(err);
      return { success: false, error: mapSaleError(err) };
    }
  },

  /**
   * Existence probe via rpc_has_any_sales: distinguishes "no sales at all"
   * from "nothing matches the selected period" (returns no receipt data).
   */
  async hasAnySales(signal?: AbortSignal): Promise<SaleApiResult<boolean>> {
    try {
      let request = supabase.rpc('rpc_has_any_sales');
      if (signal) request = request.abortSignal(signal);
      const { data, error, status } = await request;
      throwIfAborted(signal);

      if (error) {
        return { success: false, error: mapSaleError({ ...error, status }) };
      }
      if (typeof data !== 'boolean') throw new SalesDataError();

      return { success: true, data };
    } catch (err: unknown) {
      if (isAbortError(err)) throw err;
      if (err instanceof SalesDataError) return dataError(err);
      return { success: false, error: mapSaleError(err) };
    }
  },

  /**
   * Loads one receipt with its lines by UUID via rpc_get_sale. Returns data: null when it does not
   * exist (used to verify a pending, unconfirmed sale). The payload is validated like a list row.
   */
  async fetchSaleById(saleId: string, signal?: AbortSignal): Promise<SaleApiResult<Sale | null>> {
    try {
      let request = supabase.rpc('rpc_get_sale', { p_sale_id: saleId });
      if (signal) request = request.abortSignal(signal);
      const { data, error, status } = await request;
      throwIfAborted(signal);

      if (error) {
        return { success: false, error: mapSaleError({ ...error, status }) };
      }

      return { success: true, data: mapGetSaleResponse(data, saleId).sale };
    } catch (err: unknown) {
      if (isAbortError(err)) throw err;
      if (err instanceof SalesDataError) return dataError(err);
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
};
