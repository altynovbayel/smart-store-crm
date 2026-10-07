import { Trash2 } from 'lucide-react';
import type { Product, SaleFormItemState, DiscountType } from '../../../types';
import { calculateSaleItemSubtotals } from '../../../utils/saleCalculations';
import { formatCurrency } from '../../../utils/formatUtils';
import styles from './SaleFormModal.module.scss';

export interface SaleFormItemRowProps {
  index: number;
  item: SaleFormItemState;
  activeProducts: Product[];
  selectedProduct?: Product;
  allItems: SaleFormItemState[];
  errors: Record<string, string>;
  isOnlyRow: boolean;
  onProductChange: (rowId: string, newProductId: string) => void;
  onQuantityChange: (rowId: string, val: string) => void;
  onUnitPriceChange: (rowId: string, val: string) => void;
  onDiscountTypeChange: (rowId: string, type: DiscountType) => void;
  onDiscountValueChange: (rowId: string, val: string) => void;
  onRemove: (rowId: string) => void;
}

export const SaleFormItemRow = ({
  index,
  item,
  activeProducts,
  selectedProduct,
  allItems,
  errors,
  isOnlyRow,
  onProductChange,
  onQuantityChange,
  onUnitPriceChange,
  onDiscountTypeChange,
  onDiscountValueChange,
  onRemove,
}: SaleFormItemRowProps) => {
  const itemCalc = selectedProduct
    ? calculateSaleItemSubtotals(
        item.rawQuantity,
        item.rawUnitPrice,
        selectedProduct.purchasePrice,
        item.discountType,
        item.rawDiscountValue
      )
    : null;

  const prodErr = errors[`item-${item.id}-product`];
  const qtyErr = errors[`item-${item.id}-qty`];
  const priceErr = errors[`item-${item.id}-price`];
  const discountErr = errors[`item-${item.id}-discount`];

  return (
    <div className={styles.itemRow}>
      <span className={styles.rowNumber}>{index + 1}</span>

      {/* 1. Product select */}
      <div className={styles.itemColProduct}>
        <label htmlFor={`item-prod-${item.id}`} className={styles.miniLabel}>
          Товар
        </label>
        <select
          id={`item-prod-${item.id}`}
          className={styles.itemSelect}
          value={item.productId}
          onChange={(e) => onProductChange(item.id, e.target.value)}
          aria-invalid={prodErr ? 'true' : undefined}
          aria-describedby={prodErr ? `item-prod-${item.id}-err` : undefined}
        >
          <option value="">Выберите товар из каталога</option>
          {activeProducts.map((p) => {
            const isChosenElsewhere = allItems.some(
              (other) => other.id !== item.id && other.productId === p.id
            );
            return (
              <option
                key={p.id}
                value={p.id}
                disabled={isChosenElsewhere}
              >
                {p.name} ({p.sku}) — остаток: {p.stock} {p.unit}
                {isChosenElsewhere ? ' — [уже добавлен]' : ''}
              </option>
            );
          })}
        </select>
        {selectedProduct && (
          <div className={styles.productMeta}>
            <span>Артикул: {selectedProduct.sku}</span>
          </div>
        )}
        {prodErr && (
          <span
            id={`item-prod-${item.id}-err`}
            className={styles.errorText}
            role="alert"
          >
            {prodErr}
          </span>
        )}
      </div>

      {/* 2. Available stock */}
      <div className={styles.itemColStock}>
        <span className={styles.miniLabel}>Остаток</span>
        <div className={styles.stockBadge}>
          {selectedProduct ? (
            selectedProduct.stock === 0 ? (
              <span className={styles.stockEmpty}>0 {selectedProduct.unit}</span>
            ) : (
              <span>{selectedProduct.stock} {selectedProduct.unit}</span>
            )
          ) : (
            '—'
          )}
        </div>
      </div>

      {/* 3. Quantity */}
      <div className={styles.itemColQty}>
        <label htmlFor={`item-qty-${item.id}`} className={styles.miniLabel}>
          Кол-во
        </label>
        <input
          id={`item-qty-${item.id}`}
          type="text"
          inputMode="numeric"
          className={styles.itemInput}
          placeholder="1"
          value={item.rawQuantity}
          onChange={(e) => onQuantityChange(item.id, e.target.value)}
          aria-invalid={qtyErr ? 'true' : undefined}
          aria-describedby={qtyErr ? `item-qty-${item.id}-err` : undefined}
        />
        {qtyErr && (
          <span
            id={`item-qty-${item.id}-err`}
            className={styles.errorText}
            role="alert"
          >
            {qtyErr}
          </span>
        )}
      </div>

      {/* 4. Unit selling price */}
      <div className={styles.itemColPrice}>
        <label htmlFor={`item-price-${item.id}`} className={styles.miniLabel}>
          Цена за ед. (сом)
        </label>
        <input
          id={`item-price-${item.id}`}
          type="text"
          inputMode="decimal"
          className={styles.itemInput}
          placeholder="0"
          value={item.rawUnitPrice}
          onChange={(e) => onUnitPriceChange(item.id, e.target.value)}
          aria-invalid={priceErr ? 'true' : undefined}
          aria-describedby={priceErr ? `item-price-${item.id}-err` : undefined}
        />
        {priceErr && (
          <span
            id={`item-price-${item.id}-err`}
            className={styles.errorText}
            role="alert"
          >
            {priceErr}
          </span>
        )}
      </div>

      {/* 5. Discount type */}
      <div className={styles.itemColDiscountType}>
        <label htmlFor={`item-dtype-${item.id}`} className={styles.miniLabel}>
          Скидка тип
        </label>
        <select
          id={`item-dtype-${item.id}`}
          className={styles.itemSelect}
          value={item.discountType}
          onChange={(e) => onDiscountTypeChange(item.id, e.target.value as DiscountType)}
        >
          <option value="fixed">Фикс. (сом)</option>
          <option value="percent">Процент (%)</option>
        </select>
      </div>

      {/* 6. Discount value */}
      <div className={styles.itemColDiscountVal}>
        <label htmlFor={`item-dval-${item.id}`} className={styles.miniLabel}>
          Размер скидки
        </label>
        <input
          id={`item-dval-${item.id}`}
          type="text"
          inputMode="decimal"
          className={styles.itemInput}
          placeholder="0"
          value={item.rawDiscountValue}
          onChange={(e) => onDiscountValueChange(item.id, e.target.value)}
          aria-invalid={discountErr ? 'true' : undefined}
          aria-describedby={discountErr ? `item-dval-${item.id}-err` : undefined}
        />
        {discountErr && (
          <span
            id={`item-dval-${item.id}-err`}
            className={styles.errorText}
            role="alert"
          >
            {discountErr}
          </span>
        )}
      </div>

      {/* 7. Subtotal */}
      <div className={styles.itemColTotal}>
        <span className={styles.miniLabel}>Итог строки</span>
        <div className={styles.itemTotalVal}>
          {itemCalc ? (
            <>
              {itemCalc.discountAmount > 0 && (
                <span className={styles.itemGrossVal}>
                  {formatCurrency(itemCalc.grossAmount)}
                </span>
              )}
              <span>{formatCurrency(itemCalc.finalAmount)}</span>
            </>
          ) : (
            '—'
          )}
        </div>
      </div>

      {/* 8. Delete row button */}
      <div className={styles.itemColAction}>
        <button
          type="button"
          className={styles.deleteRowBtn}
          disabled={isOnlyRow}
          onClick={() => onRemove(item.id)}
          aria-label={`Удалить позицию ${index + 1}`}
          title={
            isOnlyRow
              ? 'В чеке должна остаться минимум 1 строка'
              : 'Удалить позицию'
          }
        >
          <Trash2 size={16} />
        </button>
      </div>
    </div>
  );
};
