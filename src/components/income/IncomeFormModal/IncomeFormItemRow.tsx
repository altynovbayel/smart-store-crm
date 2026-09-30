import { Trash2 } from 'lucide-react';
import type { Product, FormItemState } from '../../../types';
import { calculateItemSubtotal } from '../../../utils/incomeCalculations';
import { formatCurrency } from '../../../utils/formatUtils';
import styles from './IncomeFormModal.module.scss';

export interface IncomeFormItemRowProps {
  index: number;
  item: FormItemState;
  activeProducts: Product[];
  selectedProduct?: Product;
  allItems: FormItemState[];
  errors: Record<string, string>;
  isOnlyRow: boolean;
  onProductChange: (rowId: string, newProductId: string) => void;
  onFieldChange: (
    rowId: string,
    field: 'rawQuantity' | 'rawPurchasePrice',
    val: string
  ) => void;
  onRemove: (rowId: string) => void;
}

export const IncomeFormItemRow = ({
  index,
  item,
  activeProducts,
  selectedProduct,
  allItems,
  errors,
  isOnlyRow,
  onProductChange,
  onFieldChange,
  onRemove,
}: IncomeFormItemRowProps) => {
  const subtotal = calculateItemSubtotal(item.rawQuantity, item.rawPurchasePrice);
  const prodErr = errors[`item-${item.id}-product`];
  const qtyErr = errors[`item-${item.id}-qty`];
  const priceErr = errors[`item-${item.id}-price`];

  return (
    <div className={styles.itemRow}>
      <span className={styles.rowNumber}>{index + 1}</span>

      {/* Product select */}
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
                {p.name} ({p.sku})
                {isChosenElsewhere ? ' — [уже в накладной]' : ''}
              </option>
            );
          })}
        </select>
        {selectedProduct && (
          <div className={styles.productMeta}>
            <span>Артикул: {selectedProduct.sku}</span>
            <span>•</span>
            <span>Текущий остаток: {selectedProduct.stock} {selectedProduct.unit}</span>
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

      {/* Quantity */}
      <div className={styles.itemColQty}>
        <label htmlFor={`item-qty-${item.id}`} className={styles.miniLabel}>
          Количество
        </label>
        <input
          id={`item-qty-${item.id}`}
          type="text"
          inputMode="numeric"
          className={styles.itemInput}
          placeholder="Кол-во"
          value={item.rawQuantity}
          onChange={(e) => onFieldChange(item.id, 'rawQuantity', e.target.value)}
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

      {/* Purchase price */}
      <div className={styles.itemColPrice}>
        <label htmlFor={`item-price-${item.id}`} className={styles.miniLabel}>
          Цена закупки (сом)
        </label>
        <input
          id={`item-price-${item.id}`}
          type="text"
          inputMode="decimal"
          className={styles.itemInput}
          placeholder="Цена"
          value={item.rawPurchasePrice}
          onChange={(e) =>
            onFieldChange(item.id, 'rawPurchasePrice', e.target.value)
          }
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

      {/* Subtotal for item */}
      <div className={styles.itemColTotal}>
        <span className={styles.miniLabel}>Сумма</span>
        <div className={styles.itemTotalVal}>
          {subtotal !== null ? formatCurrency(subtotal) : '—'}
        </div>
      </div>

      {/* Delete button */}
      <div className={styles.itemColAction}>
        <button
          type="button"
          className={styles.deleteRowBtn}
          disabled={isOnlyRow}
          onClick={() => onRemove(item.id)}
          aria-label={`Удалить строку ${index + 1}`}
          title={
            isOnlyRow
              ? 'В накладной должна остаться минимум 1 строка'
              : 'Удалить строку'
          }
        >
          <Trash2 size={16} />
        </button>
      </div>
    </div>
  );
};
