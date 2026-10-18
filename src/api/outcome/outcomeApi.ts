import { supabase } from '../../lib/supabase';
import type {
  OutcomeDocument,
  OutcomeItem,
  CreateOutcomeDocumentInput,
  CreateOutcomeDocumentResult,
  FetchOutcomeDocumentsResult,
  OutcomeApiResult,
  Product,
  HistoricalPriceResult,
} from '../../types';
import { minorToSom } from '../../utils/moneyUtils';
import { resolveHistoricalPurchasePrices } from '../../utils/outcomePriceHistory';
import { fetchPriceHistoryPoints } from '../shared/priceHistoryQuery';
import {
  mapOutcomeDocumentRowToDocument,
  mapOutcomeItemRowToItem,
  mapOutcomeFormToRpcArgs,
  type OutcomeDocumentWithItemsRow,
  type OutcomeItemRow,
} from './outcomeMappers';
import { mapOutcomeError } from './outcomeErrorMapper';

export type {
  CreateOutcomeDocumentInput,
  CreateOutcomeDocumentResult,
  FetchOutcomeDocumentsResult,
  OutcomeApiResult,
  HistoricalPriceResult,
};

/**
 * Safe upper limit for fetching outcome documents into client memory.
 * Ensures all documents across time are accessible for client-side search,
 * reason filtering, period filtering (today/7d/30d), and dynamic statistics cards,
 * while preventing memory overflow or unconstrained payload transfers.
 */
export const DEFAULT_OUTCOME_FETCH_LIMIT = 5000;

/**
 * Repository / API layer for Outcome (write-off) operations via Supabase.
 * - All SELECT queries are read-only and use joined embedded items to prevent N+1 queries.
 * - All mutations (creating outcome write-off) strictly execute via transactional
 *   PostgreSQL RPC `rpc_create_outcome_document`.
 * - Direct INSERT/UPDATE/DELETE to outcome_documents, outcome_items, products,
 *   or stock_movements are strictly prohibited.
 */
export const outcomeApi = {
  /**
   * Fetches outcome documents with their embedded line items.
   * Sorted chronologically (occurred_at DESC, id DESC).
   * Safe chunked retrieval prevents PostgREST 1000 row limits.
   */
  async fetchOutcomeDocuments(
    signal?: AbortSignal,
    maxLimit: number = DEFAULT_OUTCOME_FETCH_LIMIT
  ): Promise<OutcomeApiResult<FetchOutcomeDocumentsResult>> {
    try {
      const allRows: OutcomeDocumentWithItemsRow[] = [];
      const batchSize = 1000;
      let from = 0;
      let hasMore = true;

      while (hasMore && allRows.length < maxLimit) {
        const currentBatchLimit = Math.min(batchSize, maxLimit - allRows.length);
        let query = supabase
          .from('outcome_documents')
          .select(`
            *,
            items:outcome_items(*)
          `)
          .order('occurred_at', { ascending: false })
          .order('id', { ascending: false })
          .range(from, from + currentBatchLimit - 1);

        if (signal) {
          query = query.abortSignal(signal);
        }

        const { data, error, status } = await query;

        if (error) {
          return { success: false, error: mapOutcomeError({ ...error, status }) };
        }

        const rows = (data ?? []) as unknown as OutcomeDocumentWithItemsRow[];
        allRows.push(...rows);

        if (rows.length < currentBatchLimit || allRows.length >= maxLimit) {
          hasMore = false;
        } else {
          from += rows.length;
        }
      }

      const isTruncated = allRows.length >= maxLimit;
      const documents = allRows.map(mapOutcomeDocumentRowToDocument);
      return {
        success: true,
        data: {
          documents,
          isTruncated,
          totalFetched: documents.length,
        },
      };
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw err;
      }
      return { success: false, error: mapOutcomeError(err) };
    }
  },

  /**
   * Fetches a single outcome document by its UUID including items.
   * Returns data: null when not found.
   */
  async fetchOutcomeDocumentById(
    documentId: string,
    signal?: AbortSignal
  ): Promise<OutcomeApiResult<OutcomeDocument | null>> {
    try {
      let query = supabase
        .from('outcome_documents')
        .select(`
          *,
          items:outcome_items(*)
        `)
        .eq('id', documentId);

      if (signal) {
        query = query.abortSignal(signal);
      }

      const { data, error, status } = await query.maybeSingle();

      if (error) {
        return { success: false, error: mapOutcomeError({ ...error, status }) };
      }

      if (!data) {
        return { success: true, data: null };
      }

      const document = mapOutcomeDocumentRowToDocument(
        data as unknown as OutcomeDocumentWithItemsRow
      );
      return { success: true, data: document };
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw err;
      }
      return { success: false, error: mapOutcomeError(err) };
    }
  },

  /**
   * Fetches items belonging to a specific outcome document.
   */
  async fetchOutcomeDocumentItems(
    documentId: string,
    signal?: AbortSignal
  ): Promise<OutcomeApiResult<OutcomeItem[]>> {
    try {
      let query = supabase
        .from('outcome_items')
        .select('*')
        .eq('outcome_document_id', documentId)
        .order('id', { ascending: true });

      if (signal) {
        query = query.abortSignal(signal);
      }

      const { data, error, status } = await query;

      if (error) {
        return { success: false, error: mapOutcomeError({ ...error, status }) };
      }

      const rows = (data ?? []) as unknown as OutcomeItemRow[];
      const items = rows.map(mapOutcomeItemRowToItem);
      return { success: true, data: items };
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw err;
      }
      return { success: false, error: mapOutcomeError(err) };
    }
  },

  /**
   * Creates an outcome write-off document atomically through PostgreSQL RPC rpc_create_outcome_document.
   * Decrements product stocks, checks chronology, and creates write_off stock_movements within an atomic transaction.
   * `input.id` is the mandatory idempotency UUID (`p_id`): repeating the call with the same id
   * returns the already conducted document instead of writing off stock twice.
   */
  async createOutcomeDocument(
    input: CreateOutcomeDocumentInput
  ): Promise<OutcomeApiResult<CreateOutcomeDocumentResult>> {
    try {
      // Throws OutcomeValidationError before any network call when input is invalid
      const rpcArgs = mapOutcomeFormToRpcArgs(input);

      const { data, error, status } = await supabase.rpc(
        'rpc_create_outcome_document',
        rpcArgs
      );

      if (error) {
        // Unique violation on the same idempotency key: recover the already conducted document
        if (error.code === '23505') {
          const existingRes = await outcomeApi.fetchOutcomeDocumentById(rpcArgs.p_id);
          if (existingRes.success && existingRes.data) {
            return {
              success: true,
              data: {
                id: existingRes.data.id,
                documentNumber: existingRes.data.outcomeNumber,
                totalCost: existingRes.data.totalCost,
                itemsCount: existingRes.data.items.length,
              },
            };
          }
        }
        return { success: false, error: mapOutcomeError({ ...error, status }) };
      }

      if (!data || typeof data !== 'object') {
        return {
          success: false,
          error: {
            kind: 'network',
            message: 'Сервер не вернул данные проведённого списания. Результат операции не подтверждён — проверьте статус.',
          },
        };
      }

      const responsePayload = data as {
        id?: string;
        document_number?: string;
        total_cost_minor?: number;
        items_count?: number;
      };

      if (!responsePayload.id || !responsePayload.document_number) {
        return {
          success: false,
          error: {
            kind: 'network',
            message: 'Некорректный ответ сервера при проведении списания. Результат операции не подтверждён — проверьте статус.',
          },
        };
      }

      const totalCostMinor = Number.isSafeInteger(responsePayload.total_cost_minor)
        ? (responsePayload.total_cost_minor as number)
        : 0;

      return {
        success: true,
        data: {
          id: responsePayload.id,
          documentNumber: responsePayload.document_number,
          totalCost: minorToSom(totalCostMinor),
          itemsCount: responsePayload.items_count ?? input.items.length,
        },
      };
    } catch (err: unknown) {
      return { success: false, error: mapOutcomeError(err) };
    }
  },

  /**
   * Batch fetches effective historical purchase prices for a set of products at a specific timestamp.
   * Resolution mirrors `rpc_create_outcome_document` exactly (see resolveHistoricalPurchasePrices).
   * Display-only: the server recalculates the snapshot price inside the RPC transaction.
   */
  async fetchHistoricalPurchasePrices(
    productIds: string[],
    occurredAt: string,
    activeProducts: Product[],
    signal?: AbortSignal
  ): Promise<OutcomeApiResult<Record<string, HistoricalPriceResult>>> {
    try {
      const uniqueIds = Array.from(new Set(productIds.filter(Boolean)));
      if (uniqueIds.length === 0) {
        return { success: true, data: {} };
      }

      const historyRes = await fetchPriceHistoryPoints(uniqueIds, signal);
      if (!historyRes.success) {
        return { success: false, error: mapOutcomeError(historyRes.error) };
      }
      const allRows = historyRes.rows;

      return {
        success: true,
        data: resolveHistoricalPurchasePrices(uniqueIds, allRows, occurredAt, activeProducts),
      };
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw err;
      }
      return { success: false, error: mapOutcomeError(err) };
    }
  },
};
