import {
  useReducer,
  useMemo,
  useCallback,
  type ReactNode,
} from 'react';
import type {
  Product,
  ProductFormData,
  WarehouseMovement,
  IncomeReceipt,
  IncomeReceiptItem,
  IncomeReceiptFormData,
  OutcomeDocument,
  OutcomeItem,
  OutcomeFormData,
} from '../types';
import { OUTCOME_REASONS } from '../types';
import { createInitialInventoryState } from '../data/initialState';
import {
  calculateStockStatus,
  getCategoryLabel,
  getIconTypeByCategory,
} from '../utils/productUtils';
import { toCents, fromCents } from '../utils/incomeCalculations';
import { parseCustomDate } from '../utils/dateUtils';
import {
  InventoryContext,
  type InventoryState,
  type InventoryAction,
  type InventoryContextValue,
} from './InventoryContext';

// Helper to format movement timestamps like "24.09.2026 17:35"
const formatMovementDate = (date: Date): string => {
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${day}.${month}.${year} ${hours}:${minutes}`;
};

const initialState: InventoryState = createInitialInventoryState();

const inventoryReducer = (
  state: InventoryState,
  action: InventoryAction
): InventoryState => {
  switch (action.type) {
    case 'ADD_PRODUCT': {
      const data = action.payload;
      const cleanStock = Math.max(0, data.stock);
      const cleanMinStock = Math.max(0, data.minStockThreshold);
      const status = calculateStockStatus(cleanStock, cleanMinStock);

      const newProduct: Product = {
        id: `prod-${Date.now()}`,
        name: data.name.trim(),
        sku: data.sku.trim().toUpperCase(),
        barcode: data.barcode.trim(),
        category: data.category,
        categoryLabel: getCategoryLabel(data.category),
        description: data.description.trim(),
        purchasePrice: Math.max(0, data.purchasePrice),
        sellingPrice: Math.max(0, data.sellingPrice),
        stock: cleanStock,
        minStockThreshold: cleanMinStock,
        status,
        unit: 'шт.',
        iconType: getIconTypeByCategory(data.category),
        isArchived: false,
      };

      const newMovements = [...state.movements];

      // If initial stock is greater than 0, record an opening_balance movement
      if (cleanStock > 0) {
        const openingMov: WarehouseMovement = {
          id: `mov-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
          documentNumber: `ВВОД-${new Date().getFullYear()}-${String(Math.floor(Math.random() * 900) + 100)}`,
          type: 'opening_balance',
          typeLabel: 'Начальный остаток',
          productId: newProduct.id,
          productName: newProduct.name,
          quantity: cleanStock,
          unit: newProduct.unit,
          reason: 'Ввод начального остатка при создании товара',
          createdAt: formatMovementDate(new Date()),
          author: 'Администратор',
        };
        newMovements.unshift(openingMov);
      }

      return {
        ...state,
        products: [newProduct, ...state.products],
        movements: newMovements,
      };
    }

    case 'UPDATE_PRODUCT': {
      const { id, data } = action.payload;
      const oldProduct = state.products.find((p) => p.id === id);
      if (!oldProduct) return state;

      const cleanStock = Math.max(0, data.stock);
      const cleanMinStock = Math.max(0, data.minStockThreshold);
      const status = calculateStockStatus(cleanStock, cleanMinStock);
      const quantityDelta = cleanStock - oldProduct.stock;

      const updatedProduct: Product = {
        ...oldProduct,
        name: data.name.trim(),
        sku: data.sku.trim().toUpperCase(),
        barcode: data.barcode.trim(),
        category: data.category,
        categoryLabel: getCategoryLabel(data.category),
        description: data.description.trim(),
        purchasePrice: Math.max(0, data.purchasePrice),
        sellingPrice: Math.max(0, data.sellingPrice),
        stock: cleanStock,
        minStockThreshold: cleanMinStock,
        status,
        iconType: getIconTypeByCategory(data.category),
      };

      const newMovements = [...state.movements];

      // If stock has changed, record an inventory_adjustment movement
      if (quantityDelta !== 0) {
        const adjMov: WarehouseMovement = {
          id: `mov-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
          documentNumber: `КОРР-${new Date().getFullYear()}-${String(Math.floor(Math.random() * 900) + 100)}`,
          type: 'inventory_adjustment',
          typeLabel: 'Корректировка остатка',
          productId: oldProduct.id,
          productName: updatedProduct.name,
          quantity: quantityDelta,
          unit: oldProduct.unit,
          reason:
            quantityDelta > 0
              ? 'Увеличение остатка при инвентаризации/редактировании'
              : 'Уменьшение остатка при списании/редактировании',
          createdAt: formatMovementDate(new Date()),
          author: 'Администратор',
        };
        newMovements.unshift(adjMov);
      }

      return {
        ...state,
        products: state.products.map((p) => (p.id === id ? updatedProduct : p)),
        movements: newMovements,
      };
    }

    case 'ARCHIVE_PRODUCT': {
      const { id } = action.payload;
      const target = state.products.find((p) => p.id === id);

      // Guard: Cannot archive a product with non-zero stock
      if (!target || target.stock > 0) {
        return state;
      }

      return {
        ...state,
        products: state.products.map((p) =>
          p.id === id ? { ...p, isArchived: true } : p
        ),
      };
    }

    case 'ADD_INCOME_RECEIPT': {
      const data = action.payload;

      // Validate all items atomically
      if (!data.items || data.items.length === 0) {
        return state;
      }

      const seenIds = new Set<string>();
      for (const item of data.items) {
        if (seenIds.has(item.productId)) {
          // Reject duplicate products in single receipt
          return state;
        }
        seenIds.add(item.productId);

        const prod = state.products.find(
          (p) => p.id === item.productId && !p.isArchived
        );
        if (!prod) {
          return state;
        }
        if (!Number.isSafeInteger(item.quantity) || item.quantity <= 0) {
          return state;
        }
        if (!Number.isFinite(item.purchasePrice) || item.purchasePrice < 0) {
          return state;
        }
      }

      // Generate sequential receipt number
      const currentYear = new Date().getFullYear();
      const nextIndex = state.incomeReceipts.length + 93;
      const receiptNumber = `ПР-${currentYear}-${String(nextIndex).padStart(3, '0')}`;
      const nowStr = formatMovementDate(new Date());

      // Build receipt items with exact integer cents calculation
      let receiptTotalCents = 0;
      for (const item of data.items) {
        const lineCents = item.quantity * toCents(item.purchasePrice);
        if (
          !Number.isSafeInteger(lineCents) ||
          !Number.isSafeInteger(receiptTotalCents + lineCents)
        ) {
          console.error(
            'ADD_INCOME_RECEIPT: Calculation exceeds safe integer bounds.'
          );
          return state;
        }
        receiptTotalCents += lineCents;
      }

      const receiptItems: IncomeReceiptItem[] = data.items.map((item, index) => {
        const prod = state.products.find((p) => p.id === item.productId)!;
        const lineCents = item.quantity * toCents(item.purchasePrice);

        return {
          id: `item-${Date.now()}-${index}-${Math.random().toString(36).substring(2, 6)}`,
          productId: prod.id,
          productName: prod.name,
          sku: prod.sku,
          quantity: item.quantity,
          purchasePrice: item.purchasePrice,
          totalAmount: fromCents(lineCents),
        };
      });

      const totalQuantity = receiptItems.reduce((sum, it) => sum + it.quantity, 0);
      const totalAmount = fromCents(receiptTotalCents);

      const newReceipt: IncomeReceipt = {
        id: `inc-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        receiptNumber,
        supplier: data.supplier.trim(),
        documentNumber: data.documentNumber?.trim() || '—',
        receivedAt: data.receivedAt,
        createdAt: nowStr,
        responsiblePerson: data.responsiblePerson?.trim() || 'Администратор',
        comment: data.comment?.trim() || undefined,
        items: receiptItems,
        totalQuantity,
        totalAmount,
        status: 'completed',
      };

      // Atomic product stock and purchase price update
      const updatedProducts = state.products.map((p) => {
        const incomingItem = data.items.find((it) => it.productId === p.id);
        if (!incomingItem) return p;

        const newStock = p.stock + incomingItem.quantity;
        const newPurchasePrice = incomingItem.purchasePrice;
        const newStatus = calculateStockStatus(newStock, p.minStockThreshold);

        return {
          ...p,
          stock: newStock,
          purchasePrice: newPurchasePrice,
          status: newStatus,
        };
      });

      // Atomic creation of real warehouse movements for each item
      const newMovements: WarehouseMovement[] = receiptItems.map((item) => {
        const prod = state.products.find((p) => p.id === item.productId)!;
        return {
          id: `mov-${Date.now()}-${item.productId}-${Math.random().toString(36).substring(2, 6)}`,
          documentNumber: newReceipt.receiptNumber,
          type: 'income',
          typeLabel: 'Приход',
          productId: item.productId,
          productName: item.productName,
          quantity: item.quantity,
          unit: prod.unit,
          reason: data.comment?.trim()
            ? `Приход от поставщика «${newReceipt.supplier}» (${data.comment.trim()})`
            : `Поступление от поставщика «${newReceipt.supplier}»`,
          createdAt: nowStr,
          author: newReceipt.responsiblePerson,
          receiptId: newReceipt.id,
          referenceId: newReceipt.id,
        };
      });

      return {
        ...state,
        products: updatedProducts,
        movements: [...newMovements, ...state.movements],
        incomeReceipts: [newReceipt, ...state.incomeReceipts],
      };
    }

    case 'ADD_OUTCOME_DOCUMENT': {
      const data = action.payload;

      // Validate date
      if (!data.documentDate) {
        return state;
      }
      const parsedDate = parseCustomDate(data.documentDate);
      if (!parsedDate || isNaN(parsedDate.getTime()) || parsedDate.getTime() > Date.now()) {
        return state;
      }

      // Validate all items atomically
      if (!data.items || data.items.length === 0) {
        return state;
      }

      const seenIds = new Set<string>();
      for (const item of data.items) {
        if (seenIds.has(item.productId)) {
          // Reject duplicate products in single document
          return state;
        }
        seenIds.add(item.productId);

        const prod = state.products.find(
          (p) => p.id === item.productId && !p.isArchived
        );
        if (!prod) {
          return state;
        }
        if (!Number.isSafeInteger(item.quantity) || item.quantity <= 0) {
          return state;
        }
        if (item.quantity > prod.stock) {
          return state;
        }
      }

      // Generate sequential outcome number
      const currentYear = new Date().getFullYear();
      const nextIndex = state.outcomeDocuments.length + 4;
      const outcomeNumber = `СП-${currentYear}-${String(nextIndex).padStart(3, '0')}`;
      const nowStr = formatMovementDate(new Date());

      // Build outcome items with exact integer cents calculation
      let docTotalCents = 0;
      for (const item of data.items) {
        const prod = state.products.find((p) => p.id === item.productId)!;
        const lineCents = item.quantity * toCents(prod.purchasePrice);
        if (
          !Number.isSafeInteger(lineCents) ||
          !Number.isSafeInteger(docTotalCents + lineCents)
        ) {
          console.error(
            'ADD_OUTCOME_DOCUMENT: Calculation exceeds safe integer bounds.'
          );
          return state;
        }
        docTotalCents += lineCents;
      }

      const outcomeItems: OutcomeItem[] = data.items.map((item, index) => {
        const prod = state.products.find((p) => p.id === item.productId)!;
        const lineCents = item.quantity * toCents(prod.purchasePrice);

        return {
          id: `item-out-${Date.now()}-${index}-${Math.random().toString(36).substring(2, 6)}`,
          productId: prod.id,
          productName: prod.name,
          sku: prod.sku,
          quantity: item.quantity,
          purchasePrice: prod.purchasePrice,
          totalCost: fromCents(lineCents),
        };
      });

      const totalQuantity = outcomeItems.reduce((sum, it) => sum + it.quantity, 0);
      const totalCost = fromCents(docTotalCents);

      const newOutcome: OutcomeDocument = {
        id: `out-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        outcomeNumber,
        reason: data.reason,
        documentDate: data.documentDate,
        createdAt: nowStr,
        responsiblePerson: data.responsiblePerson?.trim() || 'Администратор',
        comment: data.comment?.trim() || undefined,
        items: outcomeItems,
        totalQuantity,
        totalCost,
        status: 'completed',
      };

      // Atomic product stock update (purchasePrice does not change upon write-off)
      const updatedProducts = state.products.map((p) => {
        const outItem = data.items.find((it) => it.productId === p.id);
        if (!outItem) return p;

        const newStock = Math.max(0, p.stock - outItem.quantity);
        const newStatus = calculateStockStatus(newStock, p.minStockThreshold);

        return {
          ...p,
          stock: newStock,
          status: newStatus,
        };
      });

      // Atomic creation of real warehouse movements for each item
      const newMovements: WarehouseMovement[] = outcomeItems.map((item) => {
        const prod = state.products.find((p) => p.id === item.productId)!;
        const reasonText = OUTCOME_REASONS[newOutcome.reason];
        return {
          id: `mov-${Date.now()}-${item.productId}-${Math.random().toString(36).substring(2, 6)}`,
          documentNumber: newOutcome.outcomeNumber,
          type: 'write_off',
          typeLabel: 'Списание',
          productId: item.productId,
          productName: item.productName,
          quantity: -item.quantity,
          unit: prod.unit,
          reason: data.comment?.trim()
            ? `${reasonText} (${data.comment.trim()})`
            : reasonText,
          createdAt: nowStr,
          author: newOutcome.responsiblePerson,
          referenceId: newOutcome.id,
        };
      });

      return {
        ...state,
        products: updatedProducts,
        movements: [...newMovements, ...state.movements],
        outcomeDocuments: [newOutcome, ...state.outcomeDocuments],
      };
    }

    default:
      return state;
  }
};

export const InventoryProvider = ({ children }: { children: ReactNode }) => {
  const [state, dispatch] = useReducer(inventoryReducer, initialState);

  // Active (non-archived) products for catalog and tables
  const activeProducts = useMemo(() => {
    return state.products.filter((p) => !p.isArchived);
  }, [state.products]);

  const getProductMovements = useCallback(
    (productId: string): WarehouseMovement[] => {
      return state.movements.filter((m) => m.productId === productId);
    },
    [state.movements]
  );

  const getIncomeReceiptById = useCallback(
    (id: string): IncomeReceipt | undefined => {
      return state.incomeReceipts.find((r) => r.id === id);
    },
    [state.incomeReceipts]
  );

  const getOutcomeDocumentById = useCallback(
    (id: string): OutcomeDocument | undefined => {
      return state.outcomeDocuments.find((doc) => doc.id === id);
    },
    [state.outcomeDocuments]
  );

  const addProduct = useCallback((data: ProductFormData) => {
    dispatch({ type: 'ADD_PRODUCT', payload: data });
  }, []);

  const updateProduct = useCallback((id: string, data: ProductFormData) => {
    dispatch({ type: 'UPDATE_PRODUCT', payload: { id, data } });
  }, []);

  const archiveProduct = useCallback(
    (id: string): { success: boolean; error?: string } => {
      const target = state.products.find((p) => p.id === id);
      if (!target) {
        return { success: false, error: 'Товар не найден' };
      }
      if (target.stock > 0) {
        return {
          success: false,
          error: `Нельзя архивировать товар с ненулевым остатком (${target.stock} ${target.unit}). Сначала необходимо списать остаток.`,
        };
      }
      dispatch({ type: 'ARCHIVE_PRODUCT', payload: { id } });
      return { success: true };
    },
    [state.products]
  );

  const addIncomeReceipt = useCallback(
    (data: IncomeReceiptFormData): { success: boolean; error?: string } => {
      if (!data.supplier?.trim()) {
        return { success: false, error: 'Укажите поставщика' };
      }
      if (!data.receivedAt) {
        return { success: false, error: 'Укажите дату и время прихода' };
      }
      if (!data.items || data.items.length === 0) {
        return { success: false, error: 'Добавьте хотя бы одну позицию' };
      }

      const seenIds = new Set<string>();
      for (const item of data.items) {
        if (seenIds.has(item.productId)) {
          return {
            success: false,
            error: 'Товары в накладной не должны дублироваться',
          };
        }
        seenIds.add(item.productId);

        const target = state.products.find(
          (p) => p.id === item.productId && !p.isArchived
        );
        if (!target) {
          return {
            success: false,
            error: 'Один из выбранных товаров не найден или архивирован',
          };
        }

        if (!Number.isSafeInteger(item.quantity) || item.quantity <= 0) {
          return {
            success: false,
            error: `Количество для «${target.name}» должно быть целым числом больше нуля`,
          };
        }

        if (!Number.isFinite(item.purchasePrice) || item.purchasePrice < 0) {
          return {
            success: false,
            error: `Цена для «${target.name}» должна быть числом больше или равным нулю`,
          };
        }
      }

      let totalDocCents = 0;
      for (const item of data.items) {
        const lineCents = item.quantity * toCents(item.purchasePrice);
        if (
          !Number.isSafeInteger(lineCents) ||
          !Number.isSafeInteger(totalDocCents + lineCents)
        ) {
          return {
            success: false,
            error: 'Общая сумма накладной превышает допустимый математический предел',
          };
        }
        totalDocCents += lineCents;
      }

      dispatch({ type: 'ADD_INCOME_RECEIPT', payload: data });
      return { success: true };
    },
    [state.products]
  );

  const addOutcomeDocument = useCallback(
    (data: OutcomeFormData): { success: boolean; error?: string } => {
      if (!data.reason) {
        return { success: false, error: 'Укажите причину списания' };
      }
      if (data.reason === 'other' && !data.comment?.trim()) {
        return {
          success: false,
          error: 'Для причины «Другое» комментарий обязателен',
        };
      }
      if (!data.documentDate) {
        return { success: false, error: 'Укажите дату и время списания' };
      }
      const parsedDate = parseCustomDate(data.documentDate);
      if (!parsedDate || isNaN(parsedDate.getTime())) {
        return { success: false, error: 'Некорректная дата и время списания' };
      }
      if (parsedDate.getTime() > Date.now()) {
        return { success: false, error: 'Дата списания не может быть в будущем' };
      }
      if (!data.items || data.items.length === 0) {
        return { success: false, error: 'Добавьте хотя бы одну позицию для списания' };
      }

      const seenIds = new Set<string>();
      for (const item of data.items) {
        if (seenIds.has(item.productId)) {
          return {
            success: false,
            error: 'Товары в документе списания не должны дублироваться',
          };
        }
        seenIds.add(item.productId);

        const target = state.products.find(
          (p) => p.id === item.productId && !p.isArchived
        );
        if (!target) {
          return {
            success: false,
            error: 'Один из выбранных товаров не найден или архивирован',
          };
        }

        if (!Number.isSafeInteger(item.quantity) || item.quantity <= 0) {
          return {
            success: false,
            error: `Количество для «${target.name}» должно быть целым числом больше нуля`,
          };
        }

        if (item.quantity > target.stock) {
          return {
            success: false,
            error: `Количество к списанию (${item.quantity}) превышает остаток товара «${target.name}» (${target.stock} ${target.unit})`,
          };
        }
      }

      let totalDocCents = 0;
      for (const item of data.items) {
        const prod = state.products.find((p) => p.id === item.productId)!;
        const lineCents = item.quantity * toCents(prod.purchasePrice);
        if (
          !Number.isSafeInteger(lineCents) ||
          !Number.isSafeInteger(totalDocCents + lineCents)
        ) {
          return {
            success: false,
            error:
              'Общая сумма себестоимости списания превышает допустимый математический предел',
          };
        }
        totalDocCents += lineCents;
      }

      dispatch({ type: 'ADD_OUTCOME_DOCUMENT', payload: data });
      return { success: true };
    },
    [state.products]
  );

  const value = useMemo<InventoryContextValue>(
    () => ({
      products: state.products,
      activeProducts,
      movements: state.movements,
      incomeReceipts: state.incomeReceipts,
      outcomeDocuments: state.outcomeDocuments,
      getProductMovements,
      getIncomeReceiptById,
      getOutcomeDocumentById,
      addProduct,
      updateProduct,
      archiveProduct,
      addIncomeReceipt,
      addOutcomeDocument,
    }),
    [
      state.products,
      activeProducts,
      state.movements,
      state.incomeReceipts,
      state.outcomeDocuments,
      getProductMovements,
      getIncomeReceiptById,
      getOutcomeDocumentById,
      addProduct,
      updateProduct,
      archiveProduct,
      addIncomeReceipt,
      addOutcomeDocument,
    ]
  );

  return (
    <InventoryContext.Provider value={value}>
      {children}
    </InventoryContext.Provider>
  );
};
