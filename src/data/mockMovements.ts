import type { WarehouseMovement, Product, IncomeReceipt } from '../types';
import { initialIncomeReceipts } from './mockIncome';
import { initialWarehouseProducts } from './mockProducts';
import {
  formatDateTime,
  getRelativeDateTimeFormatted,
  parseCustomDate,
} from '../utils/dateUtils';

// Explicit manual non-income movements (sales, write-offs, inventory adjustments)
// Designed so that for every product, the chronological running balance is strictly non-negative at every step.
const nonIncomeMovements: WarehouseMovement[] = [
  {
    id: 'mov-sale-1',
    documentNumber: 'ЧЕК-#0001256',
    type: 'outcome',
    typeLabel: 'Продажа',
    productId: 'prod-1',
    productName: 'Чехол iPhone 15 Pro',
    quantity: -1,
    unit: 'шт.',
    reason: 'Розничная продажа клиенту',
    createdAt: getRelativeDateTimeFormatted(6, 16, 42),
    author: 'Кассир-продавец',
  },
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
  {
    id: 'mov-sale-2',
    documentNumber: 'ЧЕК-#0001255',
    type: 'outcome',
    typeLabel: 'Продажа',
    productId: 'prod-2',
    productName: 'Кабель Type-C 1 м',
    quantity: -2,
    unit: 'шт.',
    reason: 'Розничная продажа',
    createdAt: getRelativeDateTimeFormatted(5, 15, 18),
    author: 'Кассир-продавец',
  },
  {
    id: 'mov-sale-3',
    documentNumber: 'ЧЕК-#0001240',
    type: 'outcome',
    typeLabel: 'Продажа',
    productId: 'prod-3',
    productName: 'Защитное стекло iPhone 15',
    quantity: -22,
    unit: 'шт.',
    reason: 'Розничная продажа партии клиентам',
    createdAt: getRelativeDateTimeFormatted(1, 18, 30),
    author: 'Кассир-продавец',
  },
  {
    id: 'mov-sale-4',
    documentNumber: 'ЧЕК-#0001250',
    type: 'outcome',
    typeLabel: 'Продажа',
    productId: 'prod-4',
    productName: 'Power Bank 20 000 mAh',
    quantity: -3,
    unit: 'шт.',
    reason: 'Розничная продажа клиентам',
    // Sale occurs today in the afternoon, after the morning delivery (inc-1 at 10:30)
    createdAt: getRelativeDateTimeFormatted(0, 15, 10),
    author: 'Кассир-продавец',
  },
  {
    id: 'mov-wo-1',
    documentNumber: 'СП-2026-004',
    type: 'write_off',
    typeLabel: 'Списание',
    productId: 'prod-5',
    productName: 'Наушники TWS Pro',
    quantity: -1,
    unit: 'шт.',
    reason: 'Заводской брак (не заряжается левый наушник)',
    createdAt: getRelativeDateTimeFormatted(9, 18, 0),
    author: 'Администратор',
  },
];

// Explicit opening balances for products where initial movements complement receipts
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
];

/**
 * Pure generator creating initial warehouse movements fully synchronized
 * with initial products and income receipts so that:
 * currentStock === sum(movements.quantity) for every product.
 */
export const createInitialMovements = (
  products: Product[],
  receipts: IncomeReceipt[]
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
      createdAt: formatDateTime(receipt.receivedAt),
      author: receipt.responsiblePerson,
      receiptId: receipt.id,
      referenceId: receipt.id,
    }))
  );

  // Products with dedicated income and manual transactions
  const specialProductIds = new Set([
    'prod-1',
    'prod-2',
    'prod-3',
    'prod-4',
    'prod-5',
  ]);

  // 2. Generate opening balances for all other catalog products with stock > 0
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
    ...nonIncomeMovements,
    ...openingBalanceMovements,
    ...otherOpeningBalances,
  ];

  // Sort descending by date for UI presentation (latest first)
  allMovements.sort((a, b) => {
    const da = parseCustomDate(a.createdAt)?.getTime() ?? 0;
    const db = parseCustomDate(b.createdAt)?.getTime() ?? 0;
    return db - da;
  });

  return allMovements;
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
    return da - db;
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
  createInitialMovements(initialWarehouseProducts, initialIncomeReceipts);

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
