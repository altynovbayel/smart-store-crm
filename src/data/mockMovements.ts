import type {
  WarehouseMovement,
  Product,
  IncomeReceipt,
  OutcomeDocument,
  Sale,
} from '../types';
import { OUTCOME_REASONS } from '../types';
import { initialIncomeReceipts } from './mockIncome';
import { initialOutcomeDocuments } from './mockOutcome';
import { initialSales } from './mockSales';
import { initialWarehouseProducts } from './mockProducts';
import {
  getRelativeDateTimeFormatted,
  parseCustomDate,
} from '../utils/dateUtils';

// Explicit manual non-income movements (inventory adjustments)
// Designed so that for every product, the chronological running balance is strictly non-negative at every step.
const nonIncomeMovements: WarehouseMovement[] = [
  {
    id: 'mov-inv-1',
    documentNumber: 'ИНВ-2026-012',
    type: 'adjustment',
    typeLabel: 'Корректировка',
    productId: 'prod-1',
    productName: 'Чехол iPhone 15 Pro',
    quantity: 7,
    unit: 'шт.',
    reason: 'Плановая инвентаризация витрины',
    createdAt: getRelativeDateTimeFormatted(10, 9, 15),
    author: 'Администратор',
  },
];

// Explicit opening balances for products where initial movements complement receipts, sales, and write-offs
const openingBalanceMovements: WarehouseMovement[] = [
  {
    id: 'mov-open-prod-2',
    documentNumber: 'ВВОД-2026-002',
    type: 'opening_balance',
    typeLabel: 'Начальный остаток',
    productId: 'prod-2',
    productName: 'Кабель Type-C 1 м',
    quantity: 19,
    unit: 'шт.',
    reason: 'Ввод начального остатка склада',
    createdAt: getRelativeDateTimeFormatted(30, 9, 0),
    author: 'Администратор',
  },
  {
    id: 'mov-open-prod-5',
    documentNumber: 'ВВОД-2026-005',
    type: 'opening_balance',
    typeLabel: 'Начальный остаток',
    productId: 'prod-5',
    productName: 'Наушники TWS Pro',
    quantity: 1,
    unit: 'шт.',
    reason: 'Ввод начального остатка склада',
    createdAt: getRelativeDateTimeFormatted(30, 9, 0),
    author: 'Администратор',
  },
  {
    id: 'mov-open-prod-8',
    documentNumber: 'ВВОД-2026-008',
    type: 'opening_balance',
    typeLabel: 'Начальный остаток',
    productId: 'prod-8',
    productName: 'Автодержатель MagSafe Pro',
    quantity: 23,
    unit: 'шт.',
    reason: 'Ввод начального остатка склада',
    createdAt: getRelativeDateTimeFormatted(30, 9, 0),
    author: 'Администратор',
  },
];

/**
 * Pure generator creating initial warehouse movements fully synchronized
 * with initial products, receipts, outcomes, and sales so that:
 * currentStock === sum(movements.quantity) for every product.
 */
export const createInitialMovements = (
  products: Product[],
  receipts: IncomeReceipt[],
  outcomes: OutcomeDocument[] = initialOutcomeDocuments,
  sales: Sale[] = initialSales
): WarehouseMovement[] => {
  // 1. Generate real income movements corresponding to each item in initial receipts
  const incomeMovements: WarehouseMovement[] = receipts.flatMap((receipt) =>
    receipt.items.map((item, idx) => ({
      id: `mov-inc-${receipt.id}-${item.productId}-${idx}`,
      documentNumber: receipt.receiptNumber,
      type: 'income' as const,
      typeLabel: 'Приход',
      productId: item.productId,
      productName: item.productName,
      quantity: item.quantity,
      unit: 'шт.',
      reason: receipt.comment
        ? `Приход от поставщика «${receipt.supplier}» (${receipt.comment})`
        : `Поступление от поставщика «${receipt.supplier}»`,
      createdAt: receipt.receivedAt,
      author: receipt.responsiblePerson,
      receiptId: receipt.id,
      referenceId: receipt.id,
    }))
  );

  // 2. Generate real write-off movements corresponding to each item in outcome documents
  const outcomeMovements: WarehouseMovement[] = outcomes.flatMap((outcome) =>
    outcome.items.map((item, idx) => ({
      id: `mov-out-${outcome.id}-${item.productId}-${idx}`,
      documentNumber: outcome.outcomeNumber,
      type: 'write_off' as const,
      typeLabel: 'Списание',
      productId: item.productId,
      productName: item.productName,
      quantity: -item.quantity,
      unit: 'шт.',
      reason: outcome.comment
        ? `${OUTCOME_REASONS[outcome.reason]} (${outcome.comment})`
        : OUTCOME_REASONS[outcome.reason],
      createdAt: outcome.documentDate,
      author: outcome.responsiblePerson,
      referenceId: outcome.id,
    }))
  );

  // 3. Generate real sale movements corresponding to each item in sales
  const saleMovements: WarehouseMovement[] = sales.flatMap((sale) =>
    sale.items.map((item, idx) => ({
      id: `mov-sale-${sale.id}-${item.productId}-${idx}`,
      documentNumber: sale.receiptNumber,
      type: 'sale' as const,
      typeLabel: 'Продажа',
      productId: item.productId,
      productName: item.productName,
      quantity: -item.quantity,
      unit: 'шт.',
      reason: sale.comment || `Розничная продажа по чеку ${sale.receiptNumber}`,
      createdAt: sale.soldAt,
      author: sale.responsiblePerson,
      referenceId: sale.id,
    }))
  );

  // Products with dedicated income, outcome, sales, and manual transactions
  const specialProductIds = new Set([
    'prod-1',
    'prod-2',
    'prod-3',
    'prod-4',
    'prod-5',
    'prod-8',
  ]);

  // 4. Generate opening balances for all other catalog products with stock > 0
  const otherOpeningBalances: WarehouseMovement[] = products
    .filter((p) => !specialProductIds.has(p.id) && p.stock > 0)
    .map((p) => ({
      id: `mov-open-${p.id}`,
      documentNumber: `ВВОД-2026-${p.id.replace('prod-', '').padStart(3, '0')}`,
      type: 'opening_balance' as const,
      typeLabel: 'Начальный остаток',
      productId: p.id,
      productName: p.name,
      quantity: p.stock,
      unit: p.unit,
      reason: 'Ввод начального остатка при инвентаризации склада',
      createdAt: getRelativeDateTimeFormatted(30, 9, 0),
      author: 'Администратор',
    }));

  const allMovements = [
    ...incomeMovements,
    ...outcomeMovements,
    ...saleMovements,
    ...nonIncomeMovements,
    ...openingBalanceMovements,
    ...otherOpeningBalances,
  ];

  return sortMovementsDescending(allMovements);
};

/**
 * Sorts warehouse movements descending by date (latest first) with a stable tie-breaker.
 */
export const sortMovementsDescending = (
  movements: WarehouseMovement[]
): WarehouseMovement[] => {
  return [...movements].sort((a, b) => {
    const da = parseCustomDate(a.createdAt)?.getTime() ?? 0;
    const db = parseCustomDate(b.createdAt)?.getTime() ?? 0;
    if (da !== db) return db - da;
    // Stable tie-breaker for same date: negative movements (sale/write-off)
    // appear before positive movements in reverse-chronological presentation
    if (a.quantity < 0 && b.quantity >= 0) return -1;
    if (a.quantity >= 0 && b.quantity < 0) return 1;
    return b.id.localeCompare(a.id);
  });
};

/**
 * Validates that running balances for all products never dip below zero
 * at any point in chronological history (ascending).
 */
export const validateMovementsChronology = (
  movements: WarehouseMovement[]
): boolean => {
  const sortedAsc = [...movements].sort((a, b) => {
    const da = parseCustomDate(a.createdAt)?.getTime() ?? 0;
    const db = parseCustomDate(b.createdAt)?.getTime() ?? 0;
    if (da !== db) return da - db;
    // Stable tie-breaker: positive movements (inflow/opening/receipt)
    // are processed before negative movements (outflow/sale/write-off)
    if (a.quantity >= 0 && b.quantity < 0) return -1;
    if (a.quantity < 0 && b.quantity >= 0) return 1;
    return 0;
  });

  const balances: Record<string, number> = {};
  for (const mov of sortedAsc) {
    balances[mov.productId] = (balances[mov.productId] ?? 0) + mov.quantity;
    if (balances[mov.productId] < 0) {
      return false;
    }
  }
  return true;
};

export const initialWarehouseMovements: WarehouseMovement[] =
  createInitialMovements(
    initialWarehouseProducts,
    initialIncomeReceipts,
    initialOutcomeDocuments,
    initialSales
  );

// Verify strictly non-negative running stock in initial movements
if (!validateMovementsChronology(initialWarehouseMovements)) {
  console.error('Critical stock error: initial movements produce negative running stock!');
}

export const mockProductMovements: Record<string, WarehouseMovement[]> = {};
for (const movement of initialWarehouseMovements) {
  if (!mockProductMovements[movement.productId]) {
    mockProductMovements[movement.productId] = [];
  }
  mockProductMovements[movement.productId].push(movement);
}
