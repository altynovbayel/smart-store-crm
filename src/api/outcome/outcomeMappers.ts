import type {
  CreateOutcomeDocumentInput,
  CreateOutcomeDocumentRpcParams,
  CreateOutcomeDocumentRpcItem,
  Product,
  WarehouseCatalog,
} from '../../types';
import { isValidUuid } from '../../utils/uuidUtils';
import { OutcomeValidationError } from './outcomeValidationError';

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

/**
 * Maps a complete rpc_list_products catalog to the Product shape used by the Outcome form,
 * historical cost resolution and validation (same fields the former products SELECT produced).
 * Outcome is admin-only: a cashier response, or an admin row without a purchase price or
 * description, yields null (the whole catalog is rejected; a missing price is never 0).
 */
export const mapCatalogToOutcomeProducts = (catalog: WarehouseCatalog): Product[] | null => {
  if (catalog.role !== 'admin') return null;
  const products: Product[] = [];
  for (const item of catalog.products) {
    if (item.purchasePrice === null || item.description === null || item.priceUpdatedAt === undefined) {
      return null;
    }
    products.push({
      id: item.id,
      sku: item.sku,
      barcode: item.barcode,
      name: item.name,
      category: item.category,
      categoryLabel: item.categoryLabel,
      description: item.description,
      purchasePrice: item.purchasePrice,
      sellingPrice: item.sellingPrice,
      stock: item.stock,
      minStockThreshold: item.minStockThreshold,
      status: item.status,
      unit: item.unit,
      iconType: item.iconType,
      isArchived: item.isArchived,
      priceUpdatedAt: item.priceUpdatedAt,
    });
  }
  return products;
};
