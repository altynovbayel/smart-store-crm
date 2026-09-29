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
} from '../types';
import { initialWarehouseProducts } from '../data/mockProducts';
import { initialWarehouseMovements } from '../data/mockMovements';
import {
  calculateStockStatus,
  getCategoryLabel,
  getIconTypeByCategory,
} from '../utils/productUtils';
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

const initialState: InventoryState = {
  products: initialWarehouseProducts,
  movements: initialWarehouseMovements,
};

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

  const value = useMemo<InventoryContextValue>(
    () => ({
      products: state.products,
      activeProducts,
      movements: state.movements,
      getProductMovements,
      addProduct,
      updateProduct,
      archiveProduct,
    }),
    [
      state.products,
      activeProducts,
      state.movements,
      getProductMovements,
      addProduct,
      updateProduct,
      archiveProduct,
    ]
  );

  return (
    <InventoryContext.Provider value={value}>
      {children}
    </InventoryContext.Provider>
  );
};
