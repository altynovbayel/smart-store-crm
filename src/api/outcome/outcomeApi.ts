import { supabase } from '../../lib/supabase';
import type { Database } from '../../types/database.types';
import type {
  OutcomeDocument,
  CreateOutcomeDocumentInput,
  CreateOutcomeDocumentResult,
  FetchOutcomeDocumentsResult,
  OutcomeApiResult,
  HistoricalPriceResult,
  GetPurchasePricesAtRpcArgs,
} from '../../types';
import { PURCHASE_PRICES_RPC_MAX_PRODUCTS } from '../../types';
import { minorToSom } from '../../utils/moneyUtils';
import { mapPurchasePricesResponse, PurchasePricesDataError } from './purchasePricesRpcMappers';
import { mapOutcomeFormToRpcArgs } from './outcomeMappers';
import {
  OutcomeDataError,
  isBeforeInOutcomeOrder,
  mapGetOutcomeDocumentResponse,
  mapOutcomeDocumentsPage,
  type OutcomeDocumentsCursor,
} from './outcomeRpcMappers';
import { mapOutcomeError, mapPurchasePricesError } from './outcomeErrorMapper';

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

/** Server maximum of documents per rpc_list_outcome_documents page. */
export const OUTCOME_RPC_MAX_PAGE_SIZE = 200;
/** Hard stop against a server that never ends pagination. */
const MAX_OUTCOME_RPC_PAGES = 1000;

const abortIfNeeded = (signal?: AbortSignal): void => {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
};

const outcomeDataError = (err: OutcomeDataError): OutcomeApiResult<never> => ({
  // Malformed data: the outcome of a pending write-off stays unknown (pending UUID is preserved)
  success: false,
  error: { kind: 'internal', message: err.message },
});

/**
 * Repository / API layer for Outcome (write-off) operations via Supabase.
 * - Documents are read through the admin-only read RPCs rpc_list_outcome_documents /
 *   rpc_get_outcome_document (documents with their lines; no direct SELECT on
 *   outcome_documents / outcome_items).
 * - All mutations (creating outcome write-off) strictly execute via transactional
 *   PostgreSQL RPC `rpc_create_outcome_document`.
 * - Direct INSERT/UPDATE/DELETE to outcome_documents, outcome_items, products,
 *   or stock_movements are strictly prohibited.
 */
export const outcomeApi = {
  /**
   * Fetches write-off documents with their lines via rpc_list_outcome_documents
   * (occurred_at DESC, id DESC), page by page up to `maxLimit` documents:
   * - every page is strictly validated (exact fields, totals, order, unique ids, cursor);
   * - the next_cursor strings are passed back unchanged (no Date conversion);
   * - the first document of a page must follow the previous cursor;
   * - all-or-nothing: any failed or malformed page returns an error and no partial list.
   * isTruncated is true when the limit was reached and the server still had more documents.
   * AbortError is re-thrown so callers can ignore cancelled loads.
   */
  async fetchOutcomeDocuments(
    signal?: AbortSignal,
    maxLimit: number = DEFAULT_OUTCOME_FETCH_LIMIT
  ): Promise<OutcomeApiResult<FetchOutcomeDocumentsResult>> {
    try {
      const documents: OutcomeDocument[] = [];
      const seenDocumentIds = new Set<string>();
      const seenLineIds = new Set<string>();
      let cursor: OutcomeDocumentsCursor | null = null;
      let hasMore = true;

      for (let pageIndex = 0; hasMore && documents.length < maxLimit; pageIndex++) {
        if (pageIndex >= MAX_OUTCOME_RPC_PAGES) throw new OutcomeDataError();
        const limit = Math.min(OUTCOME_RPC_MAX_PAGE_SIZE, maxLimit - documents.length);
        const args: Database['public']['Functions']['rpc_list_outcome_documents']['Args'] = {
          p_limit: limit,
        };
        if (cursor !== null) {
          args.p_after_occurred_at = cursor.occurredAt;
          args.p_after_id = cursor.id;
        }

        let request = supabase.rpc('rpc_list_outcome_documents', args);
        if (signal) {
          request = request.abortSignal(signal);
        }
        const { data, error, status } = await request;
        abortIfNeeded(signal);
        if (error) {
          return { success: false, error: mapOutcomeError({ ...error, status }) };
        }

        const page = mapOutcomeDocumentsPage(data, limit, seenDocumentIds, seenLineIds);
        const first = page.order[0];
        if (cursor !== null && first && !isBeforeInOutcomeOrder(cursor.order, first)) {
          throw new OutcomeDataError();
        }
        // A page with a cursor but no documents would never advance
        if (page.nextCursor !== null && page.documents.length === 0) throw new OutcomeDataError();

        documents.push(...page.documents);
        cursor = page.nextCursor;
        hasMore = cursor !== null;
      }

      return {
        success: true,
        data: {
          documents,
          isTruncated: hasMore,
          totalFetched: documents.length,
        },
      };
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw err;
      }
      if (err instanceof OutcomeDataError) return outcomeDataError(err);
      return { success: false, error: mapOutcomeError(err) };
    }
  },

  /**
   * Fetches a single write-off document with its lines via rpc_get_outcome_document.
   * Returns data: null when the document does not exist (this does NOT prove that an
   * unconfirmed write-off failed — the caller retries with the same id).
   */
  async fetchOutcomeDocumentById(
    documentId: string,
    signal?: AbortSignal
  ): Promise<OutcomeApiResult<OutcomeDocument | null>> {
    try {
      let request = supabase.rpc('rpc_get_outcome_document', { p_document_id: documentId });
      if (signal) {
        request = request.abortSignal(signal);
      }
      const { data, error, status } = await request;
      abortIfNeeded(signal);
      if (error) {
        return { success: false, error: mapOutcomeError({ ...error, status }) };
      }

      return { success: true, data: mapGetOutcomeDocumentResponse(data, documentId) };
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw err;
      }
      if (err instanceof OutcomeDataError) return outcomeDataError(err);
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
   * Effective purchase prices of the selected products at the document timestamp via the admin-only
   * rpc_get_purchase_prices_at (resolved on the server exactly like rpc_create_outcome_document:
   * exact history → earliest history → current catalog price). Display-only preview: the final
   * cost snapshot is always determined by rpc_create_outcome_document.
   * - Distinct ids are requested in sorted batches of at most 500 (server limit), one after another;
   * - every response is strictly validated against its batch and the requested instant;
   * - all-or-nothing: any failed or malformed batch returns an error and no prices.
   * AbortError is re-thrown so callers can ignore cancelled loads.
   */
  async fetchHistoricalPurchasePrices(
    productIds: readonly string[],
    occurredAt: string,
    signal?: AbortSignal
  ): Promise<OutcomeApiResult<Record<string, HistoricalPriceResult>>> {
    try {
      const uniqueIds = Array.from(
        new Set(productIds.filter(Boolean).map((id) => id.toLowerCase()))
      ).sort();
      if (uniqueIds.length === 0) {
        return { success: true, data: {} };
      }

      const prices: Record<string, HistoricalPriceResult> = {};
      for (let from = 0; from < uniqueIds.length; from += PURCHASE_PRICES_RPC_MAX_PRODUCTS) {
        const batch = uniqueIds.slice(from, from + PURCHASE_PRICES_RPC_MAX_PRODUCTS);
        const args: GetPurchasePricesAtRpcArgs = { p_product_ids: batch, p_occurred_at: occurredAt };

        let request = supabase.rpc('rpc_get_purchase_prices_at', args);
        if (signal) {
          request = request.abortSignal(signal);
        }
        const { data, error, status } = await request;
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        if (error) {
          return { success: false, error: mapPurchasePricesError({ ...error, status }) };
        }

        Object.assign(prices, mapPurchasePricesResponse(data, batch, occurredAt));
      }

      return { success: true, data: prices };
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw err;
      }
      if (err instanceof PurchasePricesDataError) {
        return { success: false, error: { kind: 'internal', message: err.message } };
      }
      return { success: false, error: mapPurchasePricesError(err) };
    }
  },
};
