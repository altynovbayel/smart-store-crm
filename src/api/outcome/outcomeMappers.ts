import type { Database } from '../../types/database.types';
import type {
  OutcomeDocument,
  OutcomeItem,
  OutcomeReason,
  CreateOutcomeDocumentInput,
  CreateOutcomeDocumentRpcParams,
  CreateOutcomeDocumentRpcItem,
} from '../../types';
import { minorToSom } from '../../utils/moneyUtils';
import { isValidUuid } from '../../utils/uuidUtils';
import { OutcomeValidationError } from './outcomeValidationError';

export type OutcomeDocumentRow = Database['public']['Tables']['outcome_documents']['Row'];
export type OutcomeItemRow = Database['public']['Tables']['outcome_items']['Row'];

export interface OutcomeDocumentWithItemsRow extends OutcomeDocumentRow {
  items?: OutcomeItemRow[] | null;
}

/**
 * Maps a single Supabase outcome_items row into an application OutcomeItem,
 * preserving exact historical snapshots and converting minor units to som numbers.
 */
export const mapOutcomeItemRowToItem = (row: OutcomeItemRow): OutcomeItem => {
  const purchasePriceMinor = Number.isSafeInteger(row.purchase_price_snapshot_minor)
    ? row.purchase_price_snapshot_minor
    : 0;

  const subtotalMinor = Number.isSafeInteger(row.subtotal_minor)
    ? row.subtotal_minor
    : purchasePriceMinor * row.quantity;

  return {
    id: row.id,
    productId: row.product_id,
    productName: row.product_name_snapshot,
    sku: row.sku_snapshot,
    quantity: row.quantity,
    purchasePrice: minorToSom(purchasePriceMinor),
    totalCost: minorToSom(subtotalMinor),
  };
};

/**
 * Maps a Supabase outcome_documents row (with embedded items) into an application OutcomeDocument.
 */
export const mapOutcomeDocumentRowToDocument = (
  row: OutcomeDocumentWithItemsRow
): OutcomeDocument => {
  const rawItems = Array.isArray(row.items) ? row.items : [];
  const items = rawItems
    .map(mapOutcomeItemRowToItem)
    .sort((a, b) => a.id.localeCompare(b.id));

  const totalCostMinor = Number.isSafeInteger(row.total_cost_minor)
    ? row.total_cost_minor
    : 0;

  const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0);

  return {
    id: row.id,
    outcomeNumber: row.document_number,
    reason: row.reason as OutcomeReason,
    documentDate: row.occurred_at,
    createdAt: row.created_at,
    responsiblePerson: row.created_by_name,
    comment: row.reason_comment || undefined,
    items,
    totalQuantity,
    totalCost: minorToSom(totalCostMinor),
    status: 'completed',
  };
};

/**
 * Maps form creation input into strict typed arguments for `rpc_create_outcome_document`.
 * - Requires a strict UUID idempotency key for `p_id`.
 * - Validates date format into ISO timestamptz.
 * - Extracts only `product_id` and positive integer `quantity` for RPC `p_items`.
 * - Prevents sending duplicate product lines.
 * Throws OutcomeValidationError with a user-facing message on invalid input.
 */
export const mapOutcomeFormToRpcArgs = (
  input: CreateOutcomeDocumentInput
): CreateOutcomeDocumentRpcParams => {
  if (!isValidUuid(input.id)) {
    throw new OutcomeValidationError(
      'Внутренняя ошибка: отсутствует корректный идентификатор операции списания. Закройте форму и оформите списание заново.'
    );
  }

  if (!input.reason) {
    throw new OutcomeValidationError('Причина списания обязательна для заполнения.', 'reason');
  }

  if (input.reason === 'other' && (!input.comment || !input.comment.trim())) {
    throw new OutcomeValidationError(
      'Для причины «Другое» необходимо указать подробный комментарий.',
      'comment'
    );
  }

  if (!Array.isArray(input.items) || input.items.length === 0) {
    throw new OutcomeValidationError(
      'Документ списания должен содержать хотя бы одну позицию товара.',
      'itemsGeneral'
    );
  }

  const seenProductIds = new Set<string>();
  const rpcItems: CreateOutcomeDocumentRpcItem[] = [];

  for (const item of input.items) {
    const cleanProdId = item.productId.trim();
    if (!cleanProdId) {
      throw new OutcomeValidationError(
        'Укажите корректный товар для каждой позиции списания.',
        'itemsGeneral'
      );
    }
    if (seenProductIds.has(cleanProdId)) {
      throw new OutcomeValidationError(
        'Документ списания содержит повторяющиеся товары. Объедините позиции.',
        'itemsGeneral'
      );
    }
    seenProductIds.add(cleanProdId);

    if (!Number.isSafeInteger(item.quantity) || item.quantity <= 0) {
      throw new OutcomeValidationError(
        'Количество товара должно быть целым положительным числом.',
        'itemsGeneral'
      );
    }

    rpcItems.push({
      product_id: cleanProdId,
      quantity: item.quantity,
    });
  }

  // Parse document date to valid ISO string; default to current time
  let occurredAtIso: string;
  if (input.documentDate) {
    const parsed = new Date(input.documentDate);
    if (isNaN(parsed.getTime())) {
      throw new OutcomeValidationError('Некорректная дата и время списания.', 'documentDate');
    }
    if (parsed.getTime() > Date.now()) {
      throw new OutcomeValidationError('Дата списания не может быть в будущем.', 'documentDate');
    }
    occurredAtIso = parsed.toISOString();
  } else {
    occurredAtIso = new Date().toISOString();
  }

  return {
    p_reason: input.reason,
    p_reason_comment: input.comment?.trim() || undefined,
    p_occurred_at: occurredAtIso,
    p_items: rpcItems,
    p_id: input.id,
  };
};
