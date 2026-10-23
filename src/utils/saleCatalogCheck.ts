import type { SaleCatalogProduct, SaleItemInput } from '../types';
import { amountToMinor } from './saleMinorCalculations';

export type SaleCatalogChange =
  | { kind: 'missing'; productId: string }
  | { kind: 'price'; productId: string; name: string; expectedPrice: number; currentPrice: number }
  | { kind: 'stock'; productId: string; name: string; requested: number; available: number };

/**
 * Compares confirmed sale lines with a freshly loaded active catalog right before the RPC:
 * missing / archived product, changed selling price (compared in tyiyns) or insufficient stock.
 */
export const detectSaleCatalogChanges = (
  items: readonly SaleItemInput[],
  freshCatalog: readonly SaleCatalogProduct[]
): SaleCatalogChange[] => {
  const changes: SaleCatalogChange[] = [];

  for (const item of items) {
    const product = freshCatalog.find((p) => p.id === item.productId);
    if (!product || product.isArchived) {
      changes.push({ kind: 'missing', productId: item.productId });
      continue;
    }

    if (amountToMinor(item.unitPrice) !== amountToMinor(product.sellingPrice)) {
      changes.push({
        kind: 'price',
        productId: product.id,
        name: product.name,
        expectedPrice: item.unitPrice,
        currentPrice: product.sellingPrice,
      });
    }

    if (item.quantity > product.stock) {
      changes.push({
        kind: 'stock',
        productId: product.id,
        name: product.name,
        requested: item.quantity,
        available: product.stock,
      });
    }
  }

  return changes;
};

/** User-facing summary of catalog changes; the sale is NOT sent until the user confirms again. */
export const describeSaleCatalogChanges = (changes: readonly SaleCatalogChange[]): string => {
  const parts = changes.map((change) => {
    switch (change.kind) {
      case 'missing':
        return 'один из товаров больше недоступен (архивирован или удалён)';
      case 'price':
        return `цена «${change.name}» изменилась: ${change.expectedPrice} → ${change.currentPrice} сом`;
      case 'stock':
        return `остаток «${change.name}»: доступно ${change.available} шт., в чеке ${change.requested} шт.`;
    }
  });
  return `Каталог изменился с момента открытия формы: ${parts.join('; ')}. Каталог обновлён — проверьте строки и новый итог, затем проведите продажу ещё раз.`;
};
