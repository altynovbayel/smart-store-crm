import type { Database } from '../../types/database.types';
import type {
  Product,
  ProductCategory,
  WarehouseMovementType,
} from '../../types';
import {
  calculateStockStatus,
  getIconTypeByCategory,
  parseProductCategory,
} from '../../utils/productUtils';
import { minorToSom, somToMinor } from '../../utils/moneyUtils';

type ProductRow = Database['public']['Tables']['products']['Row'];

export const mapMovementTypeToFrontend = (
  dbType: Database['public']['Enums']['movement_type']
): { type: WarehouseMovementType; typeLabel: string } => {
  switch (dbType) {
    case 'opening_balance':
      return { type: 'opening_balance', typeLabel: 'Начальный остаток' };
    case 'income':
      return { type: 'income', typeLabel: 'Приход' };
    case 'sale':
      return { type: 'sale', typeLabel: 'Продажа' };
    case 'write_off':
      return { type: 'write_off', typeLabel: 'Списание' };
    case 'inventory_adjustment':
      return { type: 'inventory_adjustment', typeLabel: 'Инвентаризация' };
    default:
      return { type: 'inventory_adjustment', typeLabel: 'Корректировка' };
  }
};

/**
 * Maps a Supabase products row to frontend Product type.
 */
export const mapProductRowToProduct = (row: ProductRow): Product => {
  const category = parseProductCategory(row.category);
  const purchasePrice = minorToSom(row.purchase_price_minor);
  const sellingPrice = minorToSom(row.selling_price_minor);
  const stock = Number.isSafeInteger(row.stock) ? row.stock : 0;
  const minStockThreshold = Number.isSafeInteger(row.min_stock_threshold) ? row.min_stock_threshold : 0;
  const status = calculateStockStatus(stock, minStockThreshold);
  const iconType = getIconTypeByCategory(category);

  return {
    id: row.id,
    sku: row.sku,
    barcode: row.barcode,
    name: row.name,
    category,
    categoryLabel: row.category_label,
    description: row.description ?? '',
    purchasePrice,
    sellingPrice,
    stock,
    minStockThreshold,
    status,
    unit: 'шт.',
    iconType,
    isArchived: Boolean(row.is_archived),
    priceUpdatedAt: row.updated_at ? new Date(row.updated_at).getTime() : undefined,
  };
};

export interface CreateProductRpcParams {
  p_sku: string;
  p_barcode: string;
  p_name: string;
  p_category: string;
  p_category_label: string;
  p_purchase_price_minor: number;
  p_selling_price_minor: number;
  p_description?: string;
  p_stock: number;
  p_min_stock_threshold: number;
}

export interface UpdateProductRpcParams {
  p_product_id: string;
  p_sku: string;
  p_barcode: string;
  p_name: string;
  p_category: string;
  p_category_label: string;
  p_purchase_price_minor: number;
  p_selling_price_minor: number;
  p_description?: string;
  p_min_stock_threshold: number;
}

/**
 * Transforms create form inputs into rpc_create_product parameters.
 */
export const mapCreateProductToRpcArgs = (form: {
  sku: string;
  barcode: string;
  name: string;
  category: ProductCategory;
  categoryLabel: string;
  purchasePrice: number;
  sellingPrice: number;
  description?: string;
  stock: number;
  minStockThreshold: number;
}): CreateProductRpcParams => {
  return {
    p_sku: form.sku.trim().toUpperCase(),
    p_barcode: form.barcode.trim(),
    p_name: form.name.trim(),
    p_category: form.category,
    p_category_label: form.categoryLabel.trim(),
    p_purchase_price_minor: somToMinor(form.purchasePrice),
    p_selling_price_minor: somToMinor(form.sellingPrice),
    p_description: form.description?.trim() ? form.description.trim() : undefined,
    p_stock: Math.max(0, Math.floor(form.stock)),
    p_min_stock_threshold: Math.max(0, Math.floor(form.minStockThreshold)),
  };
};

/**
 * Transforms edit form inputs into rpc_update_product parameters.
 */
export const mapUpdateProductToRpcArgs = (
  productId: string,
  form: {
    sku: string;
    barcode: string;
    name: string;
    category: ProductCategory;
    categoryLabel: string;
    purchasePrice: number;
    sellingPrice: number;
    description?: string;
    minStockThreshold: number;
  }
): UpdateProductRpcParams => {
  return {
    p_product_id: productId,
    p_sku: form.sku.trim().toUpperCase(),
    p_barcode: form.barcode.trim(),
    p_name: form.name.trim(),
    p_category: form.category,
    p_category_label: form.categoryLabel.trim(),
    p_purchase_price_minor: somToMinor(form.purchasePrice),
    p_selling_price_minor: somToMinor(form.sellingPrice),
    p_description: form.description?.trim() ? form.description.trim() : undefined,
    p_min_stock_threshold: Math.max(0, Math.floor(form.minStockThreshold)),
  };
};
