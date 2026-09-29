import type { ProductCategory, ProductIconType, StockStatus } from '../types';

/**
 * Calculates stock status based on current stock and threshold
 * stockQuantity === 0 -> 'out_of_stock'
 * stockQuantity <= minStock -> 'low_stock'
 * otherwise -> 'in_stock'
 */
export const calculateStockStatus = (
  stock: number,
  minStock: number
): StockStatus => {
  if (stock <= 0) {
    return 'out_of_stock';
  }
  if (stock <= minStock) {
    return 'low_stock';
  }
  return 'in_stock';
};

export const getStockStatusLabel = (status: StockStatus): string => {
  switch (status) {
    case 'in_stock':
      return 'В наличии';
    case 'low_stock':
      return 'Мало';
    case 'out_of_stock':
      return 'Нет в наличии';
  }
};

export const getCategoryLabel = (category: ProductCategory): string => {
  switch (category) {
    case 'cases':
      return 'Чехлы';
    case 'cables':
      return 'Кабели';
    case 'glass':
      return 'Защитные стёкла';
    case 'powerbanks':
      return 'Power Bank';
    case 'headphones':
      return 'Наушники';
    case 'adapters':
      return 'Адаптеры';
    case 'memory':
      return 'Карты памяти';
    case 'holders':
      return 'Автодержатели';
  }
};

export const getIconTypeByCategory = (category: ProductCategory): ProductIconType => {
  switch (category) {
    case 'cases':
      return 'phone';
    case 'cables':
      return 'cable';
    case 'glass':
      return 'glass';
    case 'powerbanks':
      return 'powerbank';
    case 'headphones':
      return 'earphones';
    case 'adapters':
      return 'adapter';
    case 'memory':
      return 'sdcard';
    case 'holders':
      return 'holder';
  }
};
