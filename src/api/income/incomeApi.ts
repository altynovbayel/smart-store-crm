import { supabase } from '../../lib/supabase';
import type {
  IncomeReceipt,
  IncomeReceiptItem,
  CreateIncomeReceiptInput,
  CreateIncomeReceiptResult,
  FetchIncomeReceiptsResult,
  IncomeApiResult,
} from '../../types';
import { minorToSom } from '../../utils/moneyUtils';
import {
  mapIncomeReceiptRowToReceipt,
  mapIncomeItemRowToItem,
  mapIncomeReceiptFormToRpcArgs,
  type IncomeReceiptWithItemsRow,
  type IncomeItemRow,
} from './incomeMappers';
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

/**
 * Repository / API layer for Income operations via Supabase.
 * - All SELECT queries are read-only and use joined embedded items to prevent N+1 queries.
 * - All mutations (creating income receipt) strictly execute via transactional
 *   PostgreSQL RPC `rpc_create_income_receipt`.
 * - Direct INSERT/UPDATE/DELETE to income_receipts, income_items, products,
 *   or stock_movements are strictly prohibited.
 */
export const incomeApi = {
  /**
   * Fetches income receipts with their embedded line items.
   * Sorted chronologically (received_at DESC, id DESC).
   * Safe chunked retrieval prevents PostgREST 1000 row limits.
   */
  async fetchIncomeReceipts(
    signal?: AbortSignal,
    maxLimit: number = DEFAULT_INCOME_FETCH_LIMIT
  ): Promise<IncomeApiResult<FetchIncomeReceiptsResult>> {
    try {
      const allRows: IncomeReceiptWithItemsRow[] = [];
      const batchSize = 1000;
      let from = 0;
      let hasMore = true;

      while (hasMore && allRows.length < maxLimit) {
        const currentBatchLimit = Math.min(batchSize, maxLimit - allRows.length);
        let query = supabase
          .from('income_receipts')
          .select(`
            *,
            items:income_items(*)
          `)
          .order('received_at', { ascending: false })
          .order('id', { ascending: false })
          .range(from, from + currentBatchLimit - 1);

        if (signal) {
          query = query.abortSignal(signal);
        }

        const { data, error } = await query;

        if (error) {
          return { success: false, error: mapIncomeError(error) };
        }

        const rows = (data ?? []) as unknown as IncomeReceiptWithItemsRow[];
        allRows.push(...rows);

        if (rows.length < currentBatchLimit || allRows.length >= maxLimit) {
          hasMore = false;
        } else {
          from += rows.length;
        }
      }

      const isTruncated = allRows.length >= maxLimit;
      const receipts = allRows.map(mapIncomeReceiptRowToReceipt);
      return {
        success: true,
        data: {
          receipts,
          isTruncated,
          totalFetched: receipts.length,
        },
      };
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw err;
      }
      return { success: false, error: mapIncomeError(err) };
    }
  },

  /**
   * Fetches a single income receipt by its UUID including items.
   * Returns data: null when not found.
   */
  async fetchIncomeReceiptById(
    receiptId: string,
    signal?: AbortSignal
  ): Promise<IncomeApiResult<IncomeReceipt | null>> {
    try {
      let query = supabase
        .from('income_receipts')
        .select(`
          *,
          items:income_items(*)
        `)
        .eq('id', receiptId);

      if (signal) {
        query = query.abortSignal(signal);
      }

      const { data, error } = await query.maybeSingle();

      if (error) {
        return { success: false, error: mapIncomeError(error) };
      }

      if (!data) {
        return { success: true, data: null };
      }

      const receipt = mapIncomeReceiptRowToReceipt(
        data as unknown as IncomeReceiptWithItemsRow
      );
      return { success: true, data: receipt };
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw err;
      }
      return { success: false, error: mapIncomeError(err) };
    }
  },

  /**
   * Fetches items belonging to a specific income receipt.
   */
  async fetchIncomeReceiptItems(
    receiptId: string,
    signal?: AbortSignal
  ): Promise<IncomeApiResult<IncomeReceiptItem[]>> {
    try {
      let query = supabase
        .from('income_items')
        .select('*')
        .eq('income_receipt_id', receiptId)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true });

      if (signal) {
        query = query.abortSignal(signal);
      }

      const { data, error } = await query;

      if (error) {
        return { success: false, error: mapIncomeError(error) };
      }

      const rows = (data ?? []) as unknown as IncomeItemRow[];
      const items = rows.map(mapIncomeItemRowToItem);
      return { success: true, data: items };
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw err;
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
