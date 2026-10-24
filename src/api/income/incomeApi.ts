import { supabase } from '../../lib/supabase';
import type { Database } from '../../types/database.types';
import type {
  IncomeReceipt,
  CreateIncomeReceiptInput,
  CreateIncomeReceiptResult,
  FetchIncomeReceiptsResult,
  IncomeApiResult,
} from '../../types';
import { minorToSom } from '../../utils/moneyUtils';
import { mapIncomeReceiptFormToRpcArgs } from './incomeMappers';
import {
  IncomeDataError,
  isBeforeInIncomeOrder,
  mapGetIncomeReceiptResponse,
  mapIncomeReceiptsPage,
  type IncomeReceiptsCursor,
} from './incomeRpcMappers';
import { mapIncomeError } from './incomeErrorMapper';

export type {
  CreateIncomeReceiptInput,
  CreateIncomeReceiptResult,
  FetchIncomeReceiptsResult,
  IncomeApiResult,
};

/**
 * Safe upper limit for fetching income receipts into client memory.
 * Ensures all receipts across time are accessible for client-side multi-field
 * search, date filtering (today/7d/30d), and dynamic statistics cards,
 * while preventing memory overflow or unconstrained payload transfers.
 */
export const DEFAULT_INCOME_FETCH_LIMIT = 5000;

/** Server maximum of receipts per rpc_list_income_receipts page. */
export const INCOME_RPC_MAX_PAGE_SIZE = 200;
/** Hard stop against a server that never ends pagination. */
const MAX_INCOME_RPC_PAGES = 1000;

const abortIfNeeded = (signal?: AbortSignal): void => {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
};

/**
 * Repository / API layer for Income operations via Supabase.
 * - Reads go through the admin-only read RPCs rpc_list_income_receipts / rpc_get_income_receipt
 *   (receipts with their lines; no direct SELECT on income_receipts / income_items).
 * - All mutations (creating income receipt) strictly execute via transactional
 *   PostgreSQL RPC `rpc_create_income_receipt`.
 * - Direct INSERT/UPDATE/DELETE to income_receipts, income_items, products,
 *   or stock_movements are strictly prohibited.
 */
export const incomeApi = {
  /**
   * Fetches income receipts with their lines via rpc_list_income_receipts
   * (received_at DESC, id DESC), page by page up to `maxLimit` receipts:
   * - every page is strictly validated (exact fields, totals, order, unique ids, cursor);
   * - the next_cursor strings are passed back unchanged (no Date conversion);
   * - the first receipt of a page must follow the previous cursor;
   * - all-or-nothing: any failed or malformed page returns an error and no partial list.
   * isTruncated is true when the limit was reached and the server still had more receipts.
   * AbortError is re-thrown so callers can ignore cancelled loads.
   */
  async fetchIncomeReceipts(
    signal?: AbortSignal,
    maxLimit: number = DEFAULT_INCOME_FETCH_LIMIT
  ): Promise<IncomeApiResult<FetchIncomeReceiptsResult>> {
    try {
      const receipts: IncomeReceipt[] = [];
      const seenReceiptIds = new Set<string>();
      const seenLineIds = new Set<string>();
      let cursor: IncomeReceiptsCursor | null = null;
      let hasMore = true;

      for (let pageIndex = 0; hasMore && receipts.length < maxLimit; pageIndex++) {
        if (pageIndex >= MAX_INCOME_RPC_PAGES) throw new IncomeDataError();
        const limit = Math.min(INCOME_RPC_MAX_PAGE_SIZE, maxLimit - receipts.length);
        const args: Database['public']['Functions']['rpc_list_income_receipts']['Args'] = {
          p_limit: limit,
        };
        if (cursor !== null) {
          args.p_after_received_at = cursor.receivedAt;
          args.p_after_id = cursor.id;
        }

        let request = supabase.rpc('rpc_list_income_receipts', args);
        if (signal) {
          request = request.abortSignal(signal);
        }
        const { data, error, status } = await request;
        abortIfNeeded(signal);
        if (error) {
          return { success: false, error: mapIncomeError({ ...error, status }) };
        }

        const page = mapIncomeReceiptsPage(data, limit, seenReceiptIds, seenLineIds);
        const first = page.order[0];
        if (cursor !== null && first && !isBeforeInIncomeOrder(cursor.order, first)) {
          throw new IncomeDataError();
        }
        // A page with a cursor but no receipts would never advance
        if (page.nextCursor !== null && page.receipts.length === 0) throw new IncomeDataError();

        receipts.push(...page.receipts);
        cursor = page.nextCursor;
        hasMore = cursor !== null;
      }

      return {
        success: true,
        data: {
          receipts,
          isTruncated: hasMore,
          totalFetched: receipts.length,
        },
      };
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw err;
      }
      if (err instanceof IncomeDataError) {
        return { success: false, error: { message: err.message } };
      }
      return { success: false, error: mapIncomeError(err) };
    }
  },

  /**
   * Fetches a single income receipt with its lines via rpc_get_income_receipt.
   * Returns data: null when the receipt does not exist (this does NOT prove that an unconfirmed
   * creation failed — the caller retries with the same id).
   */
  async fetchIncomeReceiptById(
    receiptId: string,
    signal?: AbortSignal
  ): Promise<IncomeApiResult<IncomeReceipt | null>> {
    try {
      let request = supabase.rpc('rpc_get_income_receipt', { p_receipt_id: receiptId });
      if (signal) {
        request = request.abortSignal(signal);
      }
      const { data, error, status } = await request;
      abortIfNeeded(signal);
      if (error) {
        return { success: false, error: mapIncomeError({ ...error, status }) };
      }

      return { success: true, data: mapGetIncomeReceiptResponse(data, receiptId) };
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw err;
      }
      if (err instanceof IncomeDataError) {
        return { success: false, error: { message: err.message } };
      }
      return { success: false, error: mapIncomeError(err) };
    }
  },

  /**
   * Creates an income receipt atomically through PostgreSQL RPC rpc_create_income_receipt.
   * Updates stocks, price history, and records stock_movements within an atomic transaction.
   */
  async createIncomeReceipt(
    input: CreateIncomeReceiptInput
  ): Promise<IncomeApiResult<CreateIncomeReceiptResult>> {
    try {
      const rpcArgs = mapIncomeReceiptFormToRpcArgs(input);

      const { data, error, status } = await supabase.rpc(
        'rpc_create_income_receipt',
        rpcArgs
      );

      if (error) {
        // If a previous attempt succeeded before connection dropped, recover the conducted receipt
        if (
          input.id &&
          (error.code === '23505' ||
            error.message?.includes('income_receipts_pkey') ||
            error.message?.includes('уже существует') ||
            error.message?.includes('уже зарегистрирована'))
        ) {
          const existingRes = await incomeApi.fetchIncomeReceiptById(input.id);
          if (existingRes.success && existingRes.data) {
            return {
              success: true,
              data: {
                id: existingRes.data.id,
                receiptNumber: existingRes.data.receiptNumber,
                totalAmount: existingRes.data.totalAmount,
                itemsCount: existingRes.data.items.length,
              },
            };
          }
        }
        return { success: false, error: mapIncomeError({ ...error, status }) };
      }

      if (!data || typeof data !== 'object') {
        return {
          success: false,
          error: {
            message: 'Сервер не вернул данные проведённой накладной. Результат операции проверяется...',
            isNetworkError: true,
          },
        };
      }

      const responsePayload = data as {
        id?: string;
        receipt_number?: string;
        total_minor?: number;
        items_count?: number;
      };

      if (!responsePayload.id || !responsePayload.receipt_number) {
        return {
          success: false,
          error: {
            message: 'Некорректный ответ сервера при проведении накладной. Результат операции проверяется...',
            isNetworkError: true,
          },
        };
      }

      const totalMinor = Number.isSafeInteger(responsePayload.total_minor)
        ? (responsePayload.total_minor as number)
        : 0;

      return {
        success: true,
        data: {
          id: responsePayload.id,
          receiptNumber: responsePayload.receipt_number,
          totalAmount: minorToSom(totalMinor),
          itemsCount: responsePayload.items_count ?? input.items.length,
        },
      };
    } catch (err: unknown) {
      return { success: false, error: mapIncomeError(err) };
    }
  },
};
