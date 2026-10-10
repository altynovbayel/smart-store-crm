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
  Sale,
  SaleItem,
  SaleFormData,
} from '../types';
import { OUTCOME_REASONS, PAYMENT_METHODS } from '../types';
import { createInitialInventoryState } from '../data/initialState';
import { validateMovementsChronology, sortMovementsDescending } from '../data/mockMovements';
import {
  calculateStockStatus,
  getCategoryLabel,
  getIconTypeByCategory,
  getHistoricalPurchasePrice,
} from '../utils/productUtils';
import { toCents, fromCents } from '../utils/incomeCalculations';
import {
  formatDateTime,
  parseCustomDate,
  getDocumentTimestamp,
  normalizeDocumentTimestamp,
} from '../utils/dateUtils';
import { calculatePercentDiscountCents } from '../utils/saleCalculations';
import {
  InventoryContext,
  type InventoryState,
  type InventoryAction,
  type InventoryContextValue,
} from './InventoryContext';

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
      if (
        !Number.isSafeInteger(cleanStock) ||
        cleanStock > 100_000_000 ||
        !Number.isSafeInteger(cleanMinStock) ||
        cleanMinStock > 100_000_000
      ) {
        return state;
      }
      const status = calculateStockStatus(cleanStock, cleanMinStock);

      const now = Math.floor(Date.now() / 1000) * 1000;
      const initialPrice = Math.max(0, data.purchasePrice);

      let newProductId =
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? `prod-${crypto.randomUUID()}`
          : `prod-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      while (state.products.some((p) => p.id === newProductId)) {
        newProductId =
          typeof crypto !== 'undefined' && crypto.randomUUID
            ? `prod-${crypto.randomUUID()}`
            : `prod-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      }

      const newProduct: Product = {
        id: newProductId,
        name: data.name.trim(),
        sku: data.sku.trim().toUpperCase(),
        barcode: data.barcode.trim(),
        category: data.category,
        categoryLabel: getCategoryLabel(data.category),
        description: data.description.trim(),
        purchasePrice: initialPrice,
        sellingPrice: Math.max(0, data.sellingPrice),
        stock: cleanStock,
        minStockThreshold: cleanMinStock,
        status,
        unit: 'шт.',
        iconType: getIconTypeByCategory(data.category),
        isArchived: false,
        priceUpdatedAt: now,
        priceHistory: [
          {
            id: 1,
            purchasePrice: initialPrice,
            effectiveFrom: 0,
            createdAt: now,
          },
        ],
      };

      const newMovements = [...state.movements];

      // If initial stock is greater than 0, record an opening_balance movement
      if (cleanStock > 0) {
        const openingMov: WarehouseMovement = {
          id: `mov-${now}-${Math.random().toString(36).substring(2, 6)}`,
          documentNumber: `ВВОД-${new Date(now).getFullYear()}-${String(Math.floor(Math.random() * 900) + 100)}`,
          type: 'opening_balance',
          typeLabel: 'Начальный остаток',
          productId: newProduct.id,
          productName: newProduct.name,
          quantity: cleanStock,
          unit: newProduct.unit,
          reason: 'Ввод начального остатка при создании товара',
          createdAt: new Date(now).toISOString(),
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
      if (
        !Number.isSafeInteger(cleanStock) ||
        cleanStock > 100_000_000 ||
        !Number.isSafeInteger(cleanMinStock) ||
        cleanMinStock > 100_000_000
      ) {
        return state;
      }
      const status = calculateStockStatus(cleanStock, cleanMinStock);
      const quantityDelta = cleanStock - oldProduct.stock;
      const newPurchasePrice = Math.max(0, data.purchasePrice);
      const isPriceChanged = oldProduct.purchasePrice !== newPurchasePrice;

      const now = Date.now();
      const effectiveFrom = Math.floor(now / 1000) * 1000;

      const nextPriceHistory = oldProduct.priceHistory ? [...oldProduct.priceHistory] : [];
      if (nextPriceHistory.length === 0) {
        nextPriceHistory.push({
          id: 1,
          purchasePrice: oldProduct.purchasePrice,
          effectiveFrom: 0,
          createdAt: 0,
        });
      }

      if (isPriceChanged) {
        const nextPriceEvent = nextPriceHistory.find((e) => e.effectiveFrom > effectiveFrom);
        const nextPriceTime = nextPriceEvent ? nextPriceEvent.effectiveFrom : null;

        const hasConflictingSale = state.sales.some((s) => {
          const saleTime = getDocumentTimestamp(s.soldAt);
          if (saleTime < effectiveFrom) return false;
          if (nextPriceTime !== null && saleTime >= nextPriceTime) return false;
          return s.items.some(
            (si) => si.productId === oldProduct.id && Math.abs(si.purchasePriceSnapshot - newPurchasePrice) > 0.001
          );
        });
        if (hasConflictingSale) {
          return state;
        }

        const hasConflictingOutcome = state.outcomeDocuments.some((doc) => {
          const docTime = getDocumentTimestamp(doc.documentDate);
          if (docTime < effectiveFrom) return false;
          if (nextPriceTime !== null && docTime >= nextPriceTime) return false;
          return doc.items.some(
            (oi) => oi.productId === oldProduct.id && Math.abs(oi.purchasePrice - newPurchasePrice) > 0.001
          );
        });
        if (hasConflictingOutcome) {
          return state;
        }

        const nextId = Math.max(0, ...nextPriceHistory.map((e) => e.id ?? 0)) + 1;
        nextPriceHistory.push({
          id: nextId,
          purchasePrice: newPurchasePrice,
          effectiveFrom: effectiveFrom,
          createdAt: now,
        });
        nextPriceHistory.sort(
          (a, b) => a.effectiveFrom - b.effectiveFrom || a.createdAt - b.createdAt || (a.id ?? 0) - (b.id ?? 0)
        );
      }

      const latestEntry = nextPriceHistory.length > 0 ? nextPriceHistory[nextPriceHistory.length - 1] : null;
      const catalogPurchasePrice = latestEntry ? latestEntry.purchasePrice : newPurchasePrice;

      const updatedProduct: Product = {
        ...oldProduct,
        name: data.name.trim(),
        sku: data.sku.trim().toUpperCase(),
        barcode: data.barcode.trim(),
        category: data.category,
        categoryLabel: getCategoryLabel(data.category),
        description: data.description.trim(),
        purchasePrice: catalogPurchasePrice,
        sellingPrice: Math.max(0, data.sellingPrice),
        stock: cleanStock,
        minStockThreshold: cleanMinStock,
        status,
        iconType: getIconTypeByCategory(data.category),
        priceUpdatedAt: isPriceChanged ? now : oldProduct.priceUpdatedAt,
        priceHistory: nextPriceHistory,
      };

      const newMovements = [...state.movements];

      // If stock has changed, record an inventory_adjustment movement
      if (quantityDelta !== 0) {
        const adjMov: WarehouseMovement = {
          id: `mov-${now}-${Math.random().toString(36).substring(2, 6)}`,
          documentNumber: `КОРР-${new Date(now).getFullYear()}-${String(Math.floor(Math.random() * 900) + 100)}`,
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
          createdAt: new Date(now).toISOString(),
          author: 'Администратор',
        };
        newMovements.unshift(adjMov);

        if (!validateMovementsChronology(newMovements)) {
          return state;
        }
      }

      return {
        ...state,
        products: state.products.map((p) => (p.id === id ? updatedProduct : p)),
        movements: sortMovementsDescending(newMovements),
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

      // Validate date
      if (!data.receivedAt) {
        return state;
      }
      const parsedDate = parseCustomDate(data.receivedAt);
      if (!parsedDate || isNaN(parsedDate.getTime()) || parsedDate.getTime() > Date.now()) {
        return state;
      }

      // Validate all items atomically
      if (!data.items || data.items.length === 0) {
        return state;
      }

      const now = Date.now();
      const receiptTime = normalizeDocumentTimestamp(data.receivedAt);

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
        if (!Number.isFinite(item.purchasePrice) || item.purchasePrice < 0 || item.purchasePrice > prod.sellingPrice) {
          return state;
        }
        const newStock = prod.stock + item.quantity;
        if (!Number.isSafeInteger(newStock) || newStock > 100_000_000) {
          return state;
        }

        const nextPriceEvent = prod.priceHistory?.find((e) => e.effectiveFrom > receiptTime);
        const nextPriceTime = nextPriceEvent ? nextPriceEvent.effectiveFrom : null;

        // Conflict check: existing sales in [receiptTime, nextPriceTime) with different price
        const hasConflictingSale = state.sales.some((s) => {
          const saleTime = getDocumentTimestamp(s.soldAt);
          if (saleTime < receiptTime) return false;
          if (nextPriceTime !== null && saleTime >= nextPriceTime) return false;
          return s.items.some(
            (si) => si.productId === prod.id && Math.abs(si.purchasePriceSnapshot - item.purchasePrice) > 0.001
          );
        });
        if (hasConflictingSale) return state;

        // Conflict check: existing write-offs in [receiptTime, nextPriceTime) with different price
        const hasConflictingOutcome = state.outcomeDocuments.some((doc) => {
          const docTime = getDocumentTimestamp(doc.documentDate);
          if (docTime < receiptTime) return false;
          if (nextPriceTime !== null && docTime >= nextPriceTime) return false;
          return doc.items.some(
            (oi) => oi.productId === prod.id && Math.abs(oi.purchasePrice - item.purchasePrice) > 0.001
          );
        });
        if (hasConflictingOutcome) return state;
      }

      // Generate sequential receipt number
      const currentYear = new Date().getFullYear();
      const nextIndex = state.incomeReceipts.length + 93;
      const receiptNumber = `ПР-${currentYear}-${String(nextIndex).padStart(3, '0')}`;
      const nowStr = new Date().toISOString();

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

      const receivedAtIso = new Date(receiptTime).toISOString();

      const newReceipt: IncomeReceipt = {
        id: `inc-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        receiptNumber,
        supplier: data.supplier.trim(),
        documentNumber: data.documentNumber?.trim() || '—',
        receivedAt: receivedAtIso,
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
        let history = p.priceHistory ? [...p.priceHistory] : [];
        if (history.length === 0) {
          history.push({
            id: 1,
            purchasePrice: p.purchasePrice,
            effectiveFrom: 0,
            createdAt: 0,
          });
        }

        const nextId = Math.max(0, ...history.map((e) => e.id ?? 0)) + 1;
        history.push({
          id: nextId,
          purchasePrice: incomingItem.purchasePrice,
          effectiveFrom: receiptTime,
          createdAt: now,
        });
        history.sort(
          (a, b) => a.effectiveFrom - b.effectiveFrom || a.createdAt - b.createdAt || (a.id ?? 0) - (b.id ?? 0)
        );

        const latestEntry = history[history.length - 1];
        const newPurchasePrice = latestEntry.purchasePrice;
        const newStatus = calculateStockStatus(newStock, p.minStockThreshold);

        return {
          ...p,
          stock: newStock,
          purchasePrice: newPurchasePrice,
          priceUpdatedAt: latestEntry.createdAt,
          priceHistory: history,
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
          createdAt: newReceipt.receivedAt,
          author: newReceipt.responsiblePerson,
          receiptId: newReceipt.id,
          referenceId: newReceipt.id,
        };
      });

      return {
        ...state,
        products: updatedProducts,
        movements: sortMovementsDescending([...newMovements, ...state.movements]),
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
      const docTimestamp = normalizeDocumentTimestamp(data.documentDate);
      const nowStr = new Date().toISOString();

      // Build outcome items with exact integer cents calculation
      let docTotalCents = 0;
      for (const item of data.items) {
        const prod = state.products.find((p) => p.id === item.productId)!;
        const itemCost = getHistoricalPurchasePrice(prod, docTimestamp);
        const lineCents = item.quantity * toCents(itemCost);
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
        const itemCost = getHistoricalPurchasePrice(prod, docTimestamp);
        const lineCents = item.quantity * toCents(itemCost);

        return {
          id: `item-out-${Date.now()}-${index}-${Math.random().toString(36).substring(2, 6)}`,
          productId: prod.id,
          productName: prod.name,
          sku: prod.sku,
          quantity: item.quantity,
          purchasePrice: itemCost,
          totalCost: fromCents(lineCents),
        };
      });

      const totalQuantity = outcomeItems.reduce((sum, it) => sum + it.quantity, 0);
      const totalCost = fromCents(docTotalCents);

      const docDateIso = new Date(docTimestamp).toISOString();

      const newOutcome: OutcomeDocument = {
        id: `out-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        outcomeNumber,
        reason: data.reason,
        documentDate: docDateIso,
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
          createdAt: newOutcome.documentDate,
          author: newOutcome.responsiblePerson,
          referenceId: newOutcome.id,
        };
      });

      // Strict guard against negative historical stock balance
      if (!validateMovementsChronology([...newMovements, ...state.movements])) {
        return state;
      }

      return {
        ...state,
        products: updatedProducts,
        movements: sortMovementsDescending([...newMovements, ...state.movements]),
        outcomeDocuments: [newOutcome, ...state.outcomeDocuments],
      };
    }

    case 'ADD_SALE': {
      const data = action.payload;

      // Validate date
      if (!data.soldAt) {
        return state;
      }
      const parsedDate = parseCustomDate(data.soldAt);
      if (!parsedDate || isNaN(parsedDate.getTime()) || parsedDate.getTime() > Date.now()) {
        return state;
      }

      // Validate items atomically
      if (!data.items || data.items.length === 0) {
        return state;
      }

      const seenIds = new Set<string>();
      for (const item of data.items) {
        if (seenIds.has(item.productId)) {
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
        if (!Number.isFinite(item.unitPrice) || item.unitPrice < 0) {
          return state;
        }
        if (!Number.isFinite(item.discountValue) || item.discountValue < 0) {
          return state;
        }
      }

      let subtotalCents = 0;
      let itemDiscountTotalCents = 0;
      let itemsFinalCents = 0;
      let totalCostCents = 0;

      const soldAtTimestamp = normalizeDocumentTimestamp(data.soldAt);

      // Validate all line monetary amounts and safe integer bounds
      for (const item of data.items) {
        const prod = state.products.find((p) => p.id === item.productId);
        if (!prod) return state;
        const unitPriceCents = toCents(item.unitPrice);
        const costPrice = getHistoricalPurchasePrice(prod, soldAtTimestamp);
        const costPriceCents = toCents(costPrice);
        const lineGrossCents = item.quantity * unitPriceCents;
        const lineCostCents = item.quantity * costPriceCents;

        let lineDiscountCents = 0;
        if (item.discountType === 'percent') {
          lineDiscountCents = calculatePercentDiscountCents(lineGrossCents, item.discountValue);
        } else {
          lineDiscountCents = toCents(item.discountValue);
        }
        lineDiscountCents = Math.max(0, Math.min(lineGrossCents, lineDiscountCents));
        const lineFinalCents = lineGrossCents - lineDiscountCents;

        if (
          !Number.isSafeInteger(lineGrossCents) ||
          !Number.isSafeInteger(lineCostCents) ||
          !Number.isSafeInteger(subtotalCents + lineGrossCents) ||
          !Number.isSafeInteger(itemsFinalCents + lineFinalCents) ||
          !Number.isSafeInteger(totalCostCents + lineCostCents)
        ) {
          return state;
        }
        subtotalCents += lineGrossCents;
        itemDiscountTotalCents += lineDiscountCents;
        itemsFinalCents += lineFinalCents;
        totalCostCents += lineCostCents;
      }

      const saleItems: SaleItem[] = data.items.map((item, index) => {
        const prod = state.products.find((p) => p.id === item.productId)!;
        const unitPriceCents = toCents(item.unitPrice);
        const costPrice = getHistoricalPurchasePrice(prod, soldAtTimestamp);
        const costPriceCents = toCents(costPrice);
        const lineGrossCents = item.quantity * unitPriceCents;

        let lineDiscountCents = 0;
        if (item.discountType === 'percent') {
          lineDiscountCents = calculatePercentDiscountCents(lineGrossCents, item.discountValue);
        } else {
          lineDiscountCents = toCents(item.discountValue);
        }
        lineDiscountCents = Math.max(0, Math.min(lineGrossCents, lineDiscountCents));

        const lineFinalCents = lineGrossCents - lineDiscountCents;
        const lineCostCents = item.quantity * costPriceCents;
        const lineProfitCents = lineFinalCents - lineCostCents;

        return {
          id: `item-sale-${Date.now()}-${index}-${Math.random().toString(36).substring(2, 6)}`,
          productId: prod.id,
          productName: prod.name,
          sku: prod.sku,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          purchasePriceSnapshot: costPrice,
          grossAmount: fromCents(lineGrossCents),
          discountType: item.discountType,
          discountValue: item.discountValue,
          discountAmount: fromCents(lineDiscountCents),
          finalAmount: fromCents(lineFinalCents),
          costAmount: fromCents(lineCostCents),
          profitAmount: fromCents(lineProfitCents),
        };
      });

      // Receipt discount validation
      if (!Number.isFinite(data.receiptDiscountValue) || data.receiptDiscountValue < 0) {
        return state;
      }
      if (data.receiptDiscountType !== 'fixed' && data.receiptDiscountType !== 'percent') {
        return state;
      }
      if (data.receiptDiscountType === 'percent' && data.receiptDiscountValue > 100) {
        return state;
      }

      let receiptDiscountCents = 0;
      if (data.receiptDiscountValue > 0) {
        if (data.receiptDiscountType === 'percent') {
          receiptDiscountCents = calculatePercentDiscountCents(itemsFinalCents, data.receiptDiscountValue);
        } else {
          receiptDiscountCents = toCents(data.receiptDiscountValue);
        }
        if (receiptDiscountCents > itemsFinalCents) {
          return state;
        }
      }

      const totalAmountCents = Math.max(0, itemsFinalCents - receiptDiscountCents);
      const profitCents = totalAmountCents - totalCostCents;

      if (
        !Number.isSafeInteger(totalAmountCents) ||
        !Number.isSafeInteger(totalCostCents) ||
        !Number.isSafeInteger(profitCents)
      ) {
        return state;
      }

      let changeAmount: number | undefined;
      if (data.paymentMethod === 'cash') {
        if (
          data.receivedAmount === undefined ||
          !Number.isFinite(data.receivedAmount) ||
          data.receivedAmount < 0
        ) {
          return state;
        }
        const recCents = toCents(data.receivedAmount);
        if (
          !Number.isSafeInteger(recCents) ||
          !Number.isSafeInteger(recCents - totalAmountCents) ||
          recCents < totalAmountCents
        ) {
          return state;
        }
        changeAmount = fromCents(recCents - totalAmountCents);
      }

      const existingNumbers = state.sales
        .map((s) => {
          const match = s.receiptNumber.match(/\d+/);
          return match ? parseInt(match[0], 10) : 0;
        })
        .filter((n) => Number.isFinite(n) && n > 0);

      const maxNumber =
        existingNumbers.length > 0 ? Math.max(...existingNumbers) : 1256;
      const nextIndex = Math.max(maxNumber + 1, 1257);
      const receiptNumber = `ЧЕК-#${String(nextIndex).padStart(7, '0')}`;
      const nowStr = new Date().toISOString();
      const soldAtIso = new Date(soldAtTimestamp).toISOString();
      const formattedSoldAt = formatDateTime(soldAtIso);

      const newSale: Sale = {
        id: `sale-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        receiptNumber,
        soldAt: soldAtIso,
        createdAt: nowStr,
        paymentMethod: data.paymentMethod,
        paymentMethodLabel: PAYMENT_METHODS[data.paymentMethod],
        items: saleItems,
        subtotal: fromCents(subtotalCents),
        itemDiscountTotal: fromCents(itemDiscountTotalCents),
        receiptDiscountType: data.receiptDiscountType,
        receiptDiscountValue: data.receiptDiscountValue,
        receiptDiscountAmount: fromCents(receiptDiscountCents),
        totalAmount: fromCents(totalAmountCents),
        costAmount: fromCents(totalCostCents),
        profitAmount: fromCents(profitCents),
        receivedAmount: data.paymentMethod === 'cash' ? data.receivedAmount : undefined,
        changeAmount,
        responsiblePerson: data.responsiblePerson.trim() || 'Кассир-продавец',
        comment: data.comment?.trim() || undefined,
        status: 'completed',
        statusLabel: 'Завершено',
        primaryProductName:
          saleItems.length > 1
            ? `${saleItems[0].productName} +${saleItems.length - 1}`
            : saleItems[0]?.productName || '',
        itemsCount: saleItems.reduce((acc, it) => acc + it.quantity, 0),
        dateTimeFormatted: formattedSoldAt,
      };

      // Atomic product stock decrement
      const updatedProducts = state.products.map((p) => {
        const soldItem = data.items.find((it) => it.productId === p.id);
        if (!soldItem) return p;

        const newStock = Math.max(0, p.stock - soldItem.quantity);
        const newStatus = calculateStockStatus(newStock, p.minStockThreshold);

        return {
          ...p,
          stock: newStock,
          status: newStatus,
        };
      });

      // Atomic creation of real warehouse movements for each item
      const newMovements: WarehouseMovement[] = saleItems.map((item) => {
        const prod = state.products.find((p) => p.id === item.productId)!;
        return {
          id: `mov-${Date.now()}-${item.productId}-${Math.random().toString(36).substring(2, 6)}`,
          documentNumber: newSale.receiptNumber,
          type: 'sale',
          typeLabel: 'Продажа',
          productId: item.productId,
          productName: item.productName,
          quantity: -item.quantity,
          unit: prod.unit,
          reason: data.comment?.trim()
            ? `Продажа по чеку ${newSale.receiptNumber} (${data.comment.trim()})`
            : `Продажа по чеку ${newSale.receiptNumber}`,
          createdAt: newSale.soldAt,
          author: newSale.responsiblePerson,
          referenceId: newSale.id,
        };
      });

      // Strict guard against negative historical stock balance
      if (!validateMovementsChronology([...newMovements, ...state.movements])) {
        return state;
      }

      const updatedSales = [newSale, ...state.sales].sort((a, b) => {
        const da = parseCustomDate(a.soldAt)?.getTime() ?? 0;
        const db = parseCustomDate(b.soldAt)?.getTime() ?? 0;
        if (da !== db) return db - da;
        const ca = parseCustomDate(a.createdAt)?.getTime() ?? 0;
        const cb = parseCustomDate(b.createdAt)?.getTime() ?? 0;
        if (ca !== cb) return cb - ca;
        return b.id.localeCompare(a.id);
      });

      return {
        ...state,
        products: updatedProducts,
        movements: sortMovementsDescending([...newMovements, ...state.movements]),
        sales: updatedSales,
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
      const filtered = state.movements.filter((m) => m.productId === productId);
      return sortMovementsDescending(filtered);
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

  const updateProduct = useCallback(
    (
      id: string,
      data: ProductFormData
    ): { success: boolean; error?: string; field?: 'stock' | 'purchasePrice' } => {
      const oldProduct = state.products.find((p) => p.id === id);
      if (!oldProduct) {
        return { success: false, error: 'Товар не найден' };
      }

      const newPurchasePrice = Math.max(0, data.purchasePrice);
      const isPriceChanged = Math.abs(oldProduct.purchasePrice - newPurchasePrice) > 0.001;

      if (isPriceChanged) {
        const now = Date.now();
        const effectiveFrom = Math.floor(now / 1000) * 1000;
        const nextPriceHistory = oldProduct.priceHistory ? [...oldProduct.priceHistory] : [];
        const nextPriceEvent = nextPriceHistory.find((e) => e.effectiveFrom > effectiveFrom);
        const nextPriceTime = nextPriceEvent ? nextPriceEvent.effectiveFrom : null;

        const hasConflictingSale = state.sales.some((s) => {
          const saleTime = getDocumentTimestamp(s.soldAt);
          if (saleTime < effectiveFrom) return false;
          if (nextPriceTime !== null && saleTime >= nextPriceTime) return false;
          return s.items.some(
            (si) => si.productId === oldProduct.id && Math.abs(si.purchasePriceSnapshot - newPurchasePrice) > 0.001
          );
        });
        if (hasConflictingSale) {
          return {
            success: false,
            error: `Нельзя изменить закупочную цену для «${oldProduct.name}»: в периоде действия новой цены уже проведены продажи с другой себестоимостью`,
            field: 'purchasePrice',
          };
        }

        const hasConflictingOutcome = state.outcomeDocuments.some((doc) => {
          const docTime = getDocumentTimestamp(doc.documentDate);
          if (docTime < effectiveFrom) return false;
          if (nextPriceTime !== null && docTime >= nextPriceTime) return false;
          return doc.items.some(
            (oi) => oi.productId === oldProduct.id && Math.abs(oi.purchasePrice - newPurchasePrice) > 0.001
          );
        });
        if (hasConflictingOutcome) {
          return {
            success: false,
            error: `Нельзя изменить закупочную цену для «${oldProduct.name}»: в периоде действия новой цены уже проведены списания с другой себестоимостью`,
            field: 'purchasePrice',
          };
        }
      }

      const cleanStock = Math.max(0, data.stock);
      const quantityDelta = cleanStock - oldProduct.stock;

      if (quantityDelta !== 0) {
        const nowIso = new Date().toISOString();
        const proposedMov: WarehouseMovement = {
          id: 'temp-adj-check',
          documentNumber: 'CHECK',
          type: 'inventory_adjustment',
          typeLabel: 'Корректировка остатка',
          productId: oldProduct.id,
          productName: oldProduct.name,
          quantity: quantityDelta,
          unit: oldProduct.unit,
          reason: 'Проверка хронологии',
          createdAt: nowIso,
          author: '',
        };
        if (!validateMovementsChronology([proposedMov, ...state.movements])) {
          return {
            success: false,
            error: 'Изменение остатка приведет к отрицательному остатку в истории движений склада',
            field: 'stock',
          };
        }
      }

      dispatch({ type: 'UPDATE_PRODUCT', payload: { id, data } });
      return { success: true };
    },
    [state.products, state.sales, state.outcomeDocuments, state.movements]
  );

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
      const parsedDate = parseCustomDate(data.receivedAt);
      if (!parsedDate || isNaN(parsedDate.getTime())) {
        return { success: false, error: 'Некорректная дата и время прихода' };
      }
      if (parsedDate.getTime() > Date.now()) {
        return { success: false, error: 'Дата прихода не может быть в будущем' };
      }
      if (!data.items || data.items.length === 0) {
        return { success: false, error: 'Добавьте хотя бы одну позицию' };
      }

      // Compute exact document timestamp once for all checks and dispatch
      const receiptTime = normalizeDocumentTimestamp(data.receivedAt);
      const receivedAtIso = new Date(receiptTime).toISOString();

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

        if (item.purchasePrice > target.sellingPrice) {
          return {
            success: false,
            error: `Закупочная цена (${item.purchasePrice} сом) для «${target.name}» не может превышать цену продажи (${target.sellingPrice} сом)`,
          };
        }

        const newStock = target.stock + item.quantity;
        if (!Number.isSafeInteger(newStock) || newStock > 100_000_000) {
          return {
            success: false,
            error: `Итоговый остаток товара «${target.name}» превышает допустимый лимит (100 000 000 ${target.unit})`,
          };
        }

        const nextPriceEvent = target.priceHistory?.find((e) => e.effectiveFrom > receiptTime);
        const nextPriceTime = nextPriceEvent ? nextPriceEvent.effectiveFrom : null;

        const hasConflictingSale = state.sales.some((s) => {
          const saleTime = getDocumentTimestamp(s.soldAt);
          if (saleTime < receiptTime) return false;
          if (nextPriceTime !== null && saleTime >= nextPriceTime) return false;
          return s.items.some(
            (si) => si.productId === target.id && Math.abs(si.purchasePriceSnapshot - item.purchasePrice) > 0.001
          );
        });

        if (hasConflictingSale) {
          return {
            success: false,
            error: `Нельзя провести приход задним числом для «${target.name}» с ценой ${item.purchasePrice} сом: в этом периоде уже проведены продажи с другой себестоимостью`,
          };
        }

        const hasConflictingOutcome = state.outcomeDocuments.some((doc) => {
          const docTime = getDocumentTimestamp(doc.documentDate);
          if (docTime < receiptTime) return false;
          if (nextPriceTime !== null && docTime >= nextPriceTime) return false;
          return doc.items.some(
            (oi) => oi.productId === target.id && Math.abs(oi.purchasePrice - item.purchasePrice) > 0.001
          );
        });

        if (hasConflictingOutcome) {
          return {
            success: false,
            error: `Нельзя провести приход задним числом для «${target.name}» с ценой ${item.purchasePrice} сом: в этом периоде уже проведены списания с другой себестоимостью`,
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

      dispatch({ type: 'ADD_INCOME_RECEIPT', payload: { ...data, receivedAt: receivedAtIso } });
      return { success: true };
    },
    [state.products, state.sales, state.outcomeDocuments]
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

      // Compute exact document timestamp once for all checks and dispatch
      const docTimestamp = normalizeDocumentTimestamp(data.documentDate);
      const docDateIso = new Date(docTimestamp).toISOString();

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
        const purchasePrice = getHistoricalPurchasePrice(prod, docTimestamp);
        const lineCents = item.quantity * toCents(purchasePrice);
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

      // Strict guard: verify chronological running balance with proposed outcome movements
      const proposedMovements: WarehouseMovement[] = data.items.map((it) => ({
        id: 'temp-check',
        documentNumber: 'CHECK',
        type: 'write_off',
        typeLabel: 'Списание',
        productId: it.productId,
        productName: '',
        quantity: -it.quantity,
        unit: 'шт.',
        reason: 'Проверка хронологии',
        createdAt: docDateIso,
        author: '',
      }));

      if (!validateMovementsChronology([...proposedMovements, ...state.movements])) {
        return {
          success: false,
          error:
            'Списание на указанную дату приведет к отрицательному остатку в истории движений склада',
        };
      }

      dispatch({ type: 'ADD_OUTCOME_DOCUMENT', payload: { ...data, documentDate: docDateIso } });
      return { success: true };
    },
    [state.products, state.movements]
  );

  const getSaleById = useCallback(
    (id: string): Sale | undefined => {
      return state.sales.find((s) => s.id === id);
    },
    [state.sales]
  );

  const addSale = useCallback(
    (data: SaleFormData): { success: boolean; error?: string } => {
      if (!data.soldAt) {
        return { success: false, error: 'Укажите дату и время продажи' };
      }
      const parsedDate = parseCustomDate(data.soldAt);
      if (!parsedDate || isNaN(parsedDate.getTime())) {
        return { success: false, error: 'Некорректная дата и время продажи' };
      }
      if (parsedDate.getTime() > Date.now()) {
        return { success: false, error: 'Дата продажи не может быть в будущем' };
      }
      if (!data.paymentMethod) {
        return { success: false, error: 'Выберите способ оплаты' };
      }
      if (!data.responsiblePerson?.trim()) {
        return { success: false, error: 'Укажите ответственного сотрудника' };
      }
      if (!data.items || data.items.length === 0) {
        return { success: false, error: 'Добавьте хотя бы один товар в чек' };
      }

      // Compute exact document timestamp once for all checks and dispatch
      const soldAtTimestamp = normalizeDocumentTimestamp(data.soldAt);
      const soldAtIso = new Date(soldAtTimestamp).toISOString();

      const seenIds = new Set<string>();
      let subtotalCents = 0;
      let itemsFinalCents = 0;
      let totalCostCents = 0;

      for (const item of data.items) {
        if (seenIds.has(item.productId)) {
          return {
            success: false,
            error: 'Товары в одном чеке не должны дублироваться',
          };
        }
        seenIds.add(item.productId);

        const prod = state.products.find(
          (p) => p.id === item.productId && !p.isArchived
        );
        if (!prod) {
          return {
            success: false,
            error: 'Один из выбранных товаров не найден или архивирован',
          };
        }
        if (!Number.isSafeInteger(item.quantity) || item.quantity <= 0) {
          return {
            success: false,
            error: `Количество для «${prod.name}» должно быть целым положительным числом`,
          };
        }
        if (item.quantity > prod.stock) {
          return {
            success: false,
            error: `Количество к продаже (${item.quantity}) превышает остаток товара «${prod.name}» (${prod.stock} ${prod.unit})`,
          };
        }
        if (!Number.isFinite(item.unitPrice) || item.unitPrice < 0) {
          return {
            success: false,
            error: `Цена для «${prod.name}» должна быть числом больше или равным нулю`,
          };
        }
        if (!Number.isFinite(item.discountValue) || item.discountValue < 0) {
          return {
            success: false,
            error: `Размер скидки для «${prod.name}» указан некорректно`,
          };
        }

        const unitPriceCents = toCents(item.unitPrice);
        const lineGrossCents = item.quantity * unitPriceCents;
        let lineDiscountCents = 0;
        if (item.discountType === 'percent') {
          if (item.discountValue > 100) {
            return {
              success: false,
              error: `Процентная скидка для «${prod.name}» не может превышать 100%`,
            };
          }
          lineDiscountCents = calculatePercentDiscountCents(lineGrossCents, item.discountValue);
        } else {
          lineDiscountCents = toCents(item.discountValue);
        }
        lineDiscountCents = Math.max(0, Math.min(lineGrossCents, lineDiscountCents));
        const lineFinalCents = lineGrossCents - lineDiscountCents;

        const costPrice = getHistoricalPurchasePrice(prod, soldAtTimestamp);
        const costPriceCents = toCents(costPrice);
        const lineCostCents = item.quantity * costPriceCents;
        if (
          !Number.isSafeInteger(lineCostCents) ||
          !Number.isSafeInteger(totalCostCents + lineCostCents)
        ) {
          return {
            success: false,
            error:
              'Общая себестоимость товаров в чеке превышает допустимый математический предел',
          };
        }
        totalCostCents += lineCostCents;

        if (
          !Number.isSafeInteger(lineGrossCents) ||
          !Number.isSafeInteger(subtotalCents + lineGrossCents) ||
          !Number.isSafeInteger(itemsFinalCents + lineFinalCents)
        ) {
          return {
            success: false,
            error: 'Сумма чека превышает допустимый математический предел',
          };
        }
        subtotalCents += lineGrossCents;
        itemsFinalCents += lineFinalCents;
      }

      // Validate receipt discount parameters
      if (!Number.isFinite(data.receiptDiscountValue) || data.receiptDiscountValue < 0) {
        return {
          success: false,
          error: 'Скидка на чек должна быть неотрицательным числом',
        };
      }
      if (data.receiptDiscountType !== 'fixed' && data.receiptDiscountType !== 'percent') {
        return {
          success: false,
          error: 'Некорректный тип скидки на чек',
        };
      }
      if (data.receiptDiscountType === 'percent' && data.receiptDiscountValue > 100) {
        return {
          success: false,
          error: 'Скидка на чек не может превышать 100%',
        };
      }

      let receiptDiscountCents = 0;
      if (data.receiptDiscountValue > 0) {
        if (data.receiptDiscountType === 'percent') {
          receiptDiscountCents = calculatePercentDiscountCents(itemsFinalCents, data.receiptDiscountValue);
        } else {
          receiptDiscountCents = toCents(data.receiptDiscountValue);
        }
        if (receiptDiscountCents > itemsFinalCents) {
          return {
            success: false,
            error: 'Скидка на чек не может превышать сумму товаров',
          };
        }
      }

      const totalAmountCents = itemsFinalCents - receiptDiscountCents;
      if (totalAmountCents <= 0) {
        return {
          success: false,
          error: 'Итоговая сумма чека должна быть больше нуля',
        };
      }

      const profitCents = totalAmountCents - totalCostCents;
      if (!Number.isSafeInteger(totalAmountCents) || !Number.isSafeInteger(profitCents)) {
        return {
          success: false,
          error: 'Расчёт прибыли чека превышает допустимый математический предел',
        };
      }

      if (data.paymentMethod === 'cash') {
        if (
          data.receivedAmount === undefined ||
          !Number.isFinite(data.receivedAmount) ||
          data.receivedAmount < 0
        ) {
          return {
            success: false,
            error: 'Укажите сумму, полученную от покупателя',
          };
        }
        const receivedCents = toCents(data.receivedAmount);
        if (
          !Number.isSafeInteger(receivedCents) ||
          !Number.isSafeInteger(receivedCents - totalAmountCents)
        ) {
          return {
            success: false,
            error:
              'Сумма, полученная от покупателя, превышает допустимый математический предел',
          };
        }
        if (receivedCents < totalAmountCents) {
          return {
            success: false,
            error: `Полученная сумма (${data.receivedAmount} сом) меньше итога к оплате (${fromCents(totalAmountCents)} сом)`,
          };
        }
      }

      // Strict guard: verify chronological running balance with proposed sale movements
      const proposedMovements: WarehouseMovement[] = data.items.map((it) => ({
        id: 'temp-check',
        documentNumber: 'CHECK',
        type: 'sale',
        typeLabel: 'Продажа',
        productId: it.productId,
        productName: '',
        quantity: -it.quantity,
        unit: 'шт.',
        reason: 'Проверка хронологии',
        createdAt: soldAtIso,
        author: '',
      }));

      if (!validateMovementsChronology([...proposedMovements, ...state.movements])) {
        return {
          success: false,
          error:
            'Продажа на указанную дату приведет к отрицательному остатку в истории движений склада',
        };
      }

      dispatch({ type: 'ADD_SALE', payload: { ...data, soldAt: soldAtIso } });
      return { success: true };
    },
    [state.products, state.movements]
  );

  const value = useMemo<InventoryContextValue>(
    () => ({
      products: state.products,
      activeProducts,
      movements: state.movements,
      incomeReceipts: state.incomeReceipts,
      outcomeDocuments: state.outcomeDocuments,
      sales: state.sales,
      getProductMovements,
      getIncomeReceiptById,
      getOutcomeDocumentById,
      getSaleById,
      addProduct,
      updateProduct,
      archiveProduct,
      addIncomeReceipt,
      addOutcomeDocument,
      addSale,
    }),
    [
      state.products,
      activeProducts,
      state.movements,
      state.incomeReceipts,
      state.outcomeDocuments,
      state.sales,
      getProductMovements,
      getIncomeReceiptById,
      getOutcomeDocumentById,
      getSaleById,
      addProduct,
      updateProduct,
      archiveProduct,
      addIncomeReceipt,
      addOutcomeDocument,
      addSale,
    ]
  );

  return (
    <InventoryContext.Provider value={value}>
      {children}
    </InventoryContext.Provider>
  );
};
