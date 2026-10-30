import type { Database } from '../../types/database.types';
import type {
  CatalogAccessRole,
  StockStatus,
  WarehouseCatalogProduct,
  WarehouseMovementView,
  WarehouseRestoreResult,
} from '../../types';
import { minorToSom, MAX_SAFE_PRICE_MINOR } from '../../utils/moneyUtils';
import { calculateStockStatus, getIconTypeByCategory, parseProductCategory } from '../../utils/productUtils';
import { isValidUuid } from '../../utils/uuidUtils';
import { toEpochMicros } from '../../utils/outcomePriceHistory';
import { mapMovementTypeToFrontend } from './warehouseMappers';

/** Raised when a role-aware catalog / movement page is malformed or inconsistent. */
export class WarehouseCatalogDataError extends Error {
  constructor(message = 'Сервер вернул некорректные данные склада. Повторите загрузку.') {
    super(message);
    this.name = 'WarehouseCatalogDataError';
  }
}

type JsonRecord = Record<string, unknown>;
type MovementType = Database['public']['Enums']['movement_type'];

const MAX_STOCK = 100_000_000;
const MOVEMENT_TYPES: ReadonlySet<string> = new Set<MovementType>([
  'opening_balance',
  'income',
  'sale',
  'write_off',
  'inventory_adjustment',
]);
const STOCK_STATUSES: ReadonlySet<string> = new Set<StockStatus>(['in_stock', 'low_stock', 'out_of_stock']);

/** Exact field sets per role (migration 20261019100000). Any other key rejects the page. */
const PRODUCT_KEYS: Record<CatalogAccessRole, readonly string[]> = {
  admin: [
    'id', 'sku', 'barcode', 'name', 'category', 'category_label', 'description',
    'purchase_price_minor', 'selling_price_minor', 'stock', 'min_stock_threshold',
    'status', 'is_archived', 'created_at', 'updated_at',
  ],
  cashier: [
    'id', 'sku', 'barcode', 'name', 'category', 'category_label',
    'selling_price_minor', 'stock', 'min_stock_threshold', 'status', 'is_archived',
  ],
};

const MOVEMENT_KEYS: Record<CatalogAccessRole, readonly string[]> = {
  admin: [
    'id', 'product_id', 'movement_type', 'quantity_delta', 'balance_after', 'occurred_at',
    'created_at', 'reference_id', 'reference_number', 'product_name_snapshot', 'note', 'responsible_name',
  ],
  cashier: ['id', 'movement_type', 'quantity_delta', 'balance_after', 'occurred_at', 'reference_number'],
};

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const readRecord = (value: unknown): JsonRecord => {
  if (!isRecord(value)) throw new WarehouseCatalogDataError();
  return value;
};

const assertExactKeys = (row: JsonRecord, expected: readonly string[]): void => {
  const keys = Object.keys(row);
  if (keys.length !== expected.length || !expected.every((k) => Object.prototype.hasOwnProperty.call(row, k))) {
    throw new WarehouseCatalogDataError();
  }
};

const readString = (row: JsonRecord, key: string): string => {
  const value = row[key];
  if (typeof value !== 'string') throw new WarehouseCatalogDataError();
  return value;
};

const readNullableString = (row: JsonRecord, key: string): string | null => {
  const value = row[key];
  if (value === null) return null;
  if (typeof value !== 'string') throw new WarehouseCatalogDataError();
  return value;
};

const readInt = (row: JsonRecord, key: string, min: number, max: number): number => {
  const value = row[key];
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new WarehouseCatalogDataError();
  }
  return value;
};

const readUuid = (row: JsonRecord, key: string): string => {
  const value = row[key];
  // PostgreSQL emits canonical lowercase uuids; string order then equals uuid byte order
  if (!isValidUuid(value) || value !== value.toLowerCase()) throw new WarehouseCatalogDataError();
  return value;
};

const readTimestamp = (row: JsonRecord, key: string): string => {
  const value = readString(row, key);
  if (toEpochMicros(value) === null) throw new WarehouseCatalogDataError();
  return value;
};

export const readCatalogRole = (root: JsonRecord): CatalogAccessRole => {
  const role = root.role;
  if (role !== 'admin' && role !== 'cashier') throw new WarehouseCatalogDataError();
  return role;
};

/** Parses one catalog row for the given role; never fabricates admin-only values for a cashier. */
export const mapCatalogProductRow = (value: unknown, role: CatalogAccessRole): WarehouseCatalogProduct => {
  const row = readRecord(value);
  assertExactKeys(row, PRODUCT_KEYS[role]);

  const stock = readInt(row, 'stock', 0, MAX_STOCK);
  const minStockThreshold = readInt(row, 'min_stock_threshold', 0, MAX_STOCK);
  const status = readString(row, 'status');
  if (!STOCK_STATUSES.has(status) || status !== calculateStockStatus(stock, minStockThreshold)) {
    throw new WarehouseCatalogDataError();
  }
  const isArchived = row.is_archived;
  if (typeof isArchived !== 'boolean') throw new WarehouseCatalogDataError();

  const category = parseProductCategory(readString(row, 'category'));
  const base = {
    id: readUuid(row, 'id'),
    sku: readString(row, 'sku'),
    barcode: readString(row, 'barcode'),
    name: readString(row, 'name'),
    category,
    categoryLabel: readString(row, 'category_label'),
    sellingPrice: minorToSom(readInt(row, 'selling_price_minor', 0, MAX_SAFE_PRICE_MINOR)),
    stock,
    minStockThreshold,
    status: calculateStockStatus(stock, minStockThreshold),
    isArchived,
    unit: 'шт.',
    iconType: getIconTypeByCategory(category),
  };

  if (role === 'cashier') {
    return { ...base, purchasePrice: null, description: null };
  }

  const updatedAt = readTimestamp(row, 'updated_at');
  readTimestamp(row, 'created_at');
  return {
    ...base,
    purchasePrice: minorToSom(readInt(row, 'purchase_price_minor', 0, MAX_SAFE_PRICE_MINOR)),
    description: readNullableString(row, 'description') ?? '',
    priceUpdatedAt: new Date(updatedAt).getTime(),
  };
};

export interface CatalogPage {
  role: CatalogAccessRole;
  products: WarehouseCatalogProduct[];
  nextAfterId: string | null;
}

/** Parses a rpc_list_products page: rows ordered by id ASC, next_after_id = last id of a full page. */
export const mapCatalogPage = (data: unknown, limit: number): CatalogPage => {
  const root = readRecord(data);
  assertExactKeys(root, ['role', 'rows', 'next_after_id']);
  const role = readCatalogRole(root);
  if (!Array.isArray(root.rows) || root.rows.length > limit) throw new WarehouseCatalogDataError();

  const products = root.rows.map((row) => mapCatalogProductRow(row, role));
  for (let i = 1; i < products.length; i++) {
    if (!(products[i - 1].id < products[i].id)) throw new WarehouseCatalogDataError();
  }

  const next = root.next_after_id;
  let nextAfterId: string | null = null;
  if (next !== null) {
    if (!isValidUuid(next) || next !== next.toLowerCase()) throw new WarehouseCatalogDataError();
    if (products.length !== limit || products[products.length - 1].id !== next) {
      throw new WarehouseCatalogDataError();
    }
    nextAfterId = next;
  }

  return { role, products, nextAfterId };
};

/**
 * Parses a rpc_list_archived_products page (migration 20261030100000): the admin catalog page
 * contract where every row is archived. A cashier role or an active row rejects the whole page.
 */
export const mapArchivedCatalogPage = (data: unknown, limit: number): CatalogPage => {
  const page = mapCatalogPage(data, limit);
  if (page.role !== 'admin' || page.products.some((p) => !p.isArchived)) {
    throw new WarehouseCatalogDataError();
  }
  return page;
};

/**
 * Parses rpc_restore_product: exactly { restored, product }, where product is an admin catalog
 * row of the requested product and is active. Anything else rejects the whole response.
 */
export const mapRestoreProductResult = (data: unknown, productId: string): WarehouseRestoreResult => {
  const root = readRecord(data);
  assertExactKeys(root, ['restored', 'product']);
  const restored = root.restored;
  if (typeof restored !== 'boolean') throw new WarehouseCatalogDataError();
  const product = mapCatalogProductRow(root.product, 'admin');
  if (product.id !== productId || product.isArchived) throw new WarehouseCatalogDataError();
  return { restored, product };
};

/** Movement cursor exactly as sent by the server (strings are passed back unchanged). */
export interface MovementCursor {
  occurredAt: string;
  createdAt: string;
  id: string;
}

export interface MovementsPage {
  role: CatalogAccessRole;
  movements: WarehouseMovementView[];
  /** occurred_at micros + id of every row, for order / cursor checks. */
  order: Array<{ occurredMicros: number; id: string }>;
  nextCursor: MovementCursor | null;
}

/** Parses one movement row for the given role; cashier rows never get note / responsible data. */
export const mapMovementRow = (
  value: unknown,
  role: CatalogAccessRole
): { movement: WarehouseMovementView; occurredMicros: number } => {
  const row = readRecord(value);
  assertExactKeys(row, MOVEMENT_KEYS[role]);

  const id = readUuid(row, 'id');
  const movementType = readString(row, 'movement_type');
  if (!MOVEMENT_TYPES.has(movementType)) throw new WarehouseCatalogDataError();
  const { type, typeLabel } = mapMovementTypeToFrontend(movementType as MovementType);
  const occurredAt = readTimestamp(row, 'occurred_at');
  const occurredMicros = toEpochMicros(occurredAt);
  if (occurredMicros === null) throw new WarehouseCatalogDataError();
  const quantity = readInt(row, 'quantity_delta', -MAX_STOCK, MAX_STOCK);
  if (quantity === 0) throw new WarehouseCatalogDataError();
  const referenceNumber = readNullableString(row, 'reference_number');

  const movement: WarehouseMovementView = {
    id,
    documentNumber: referenceNumber ?? `ДВИЖ-${id.substring(0, 8)}`,
    type,
    typeLabel,
    quantity,
    balanceAfter: readInt(row, 'balance_after', 0, MAX_STOCK),
    unit: 'шт.',
    createdAt: occurredAt,
  };

  if (role === 'admin') {
    readUuid(row, 'product_id');
    readTimestamp(row, 'created_at');
    if (row.reference_id !== null) readUuid(row, 'reference_id');
    readString(row, 'product_name_snapshot');
    const note = readNullableString(row, 'note');
    movement.reason = note ?? undefined;
    movement.author = readString(row, 'responsible_name');
  }

  return { movement, occurredMicros };
};

/**
 * Parses a rpc_list_product_movements page: rows ordered by occurred_at DESC (ties by created_at,
 * id DESC); next_cursor only for a full page and equal to its last row (occurred_at + id).
 */
export const mapMovementsPage = (data: unknown, limit: number): MovementsPage => {
  const root = readRecord(data);
  assertExactKeys(root, ['role', 'rows', 'next_cursor']);
  const role = readCatalogRole(root);
  if (!Array.isArray(root.rows) || root.rows.length > limit) throw new WarehouseCatalogDataError();

  const parsed = root.rows.map((row) => mapMovementRow(row, role));
  for (let i = 1; i < parsed.length; i++) {
    if (parsed[i].occurredMicros > parsed[i - 1].occurredMicros) throw new WarehouseCatalogDataError();
  }

  let nextCursor: MovementCursor | null = null;
  if (root.next_cursor !== null) {
    const cursor = readRecord(root.next_cursor);
    assertExactKeys(cursor, ['occurred_at', 'created_at', 'id']);
    nextCursor = {
      occurredAt: readTimestamp(cursor, 'occurred_at'),
      createdAt: readTimestamp(cursor, 'created_at'),
      id: readUuid(cursor, 'id'),
    };
    const last = parsed[parsed.length - 1];
    if (
      parsed.length !== limit ||
      !last ||
      last.movement.id !== nextCursor.id ||
      last.occurredMicros !== toEpochMicros(nextCursor.occurredAt)
    ) {
      throw new WarehouseCatalogDataError();
    }
  }

  return {
    role,
    movements: parsed.map((p) => p.movement),
    order: parsed.map((p) => ({ occurredMicros: p.occurredMicros, id: p.movement.id })),
    nextCursor,
  };
};

/** Strict tuple order of cursors: (occurred_at, created_at, id) must strictly decrease. */
export const isCursorBefore = (next: MovementCursor, previous: MovementCursor): boolean => {
  const a = [toEpochMicros(next.occurredAt), toEpochMicros(next.createdAt)];
  const b = [toEpochMicros(previous.occurredAt), toEpochMicros(previous.createdAt)];
  if (a[0] === null || a[1] === null || b[0] === null || b[1] === null) return false;
  if (a[0] !== b[0]) return a[0] < b[0];
  if (a[1] !== b[1]) return a[1] < b[1];
  return next.id < previous.id;
};
