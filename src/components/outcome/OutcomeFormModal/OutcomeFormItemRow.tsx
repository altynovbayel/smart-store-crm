import { Trash2 } from 'lucide-react';
import type {
  Product,
  OutcomeFormItemState,
  HistoricalPriceResult,
} from '../../../types';
import { calculateOutcomeSubtotal } from '../../../utils/outcomeCalculations';
import { formatCurrency } from '../../../utils/formatUtils';
import styles from './OutcomeFormModal.module.scss';

export interface OutcomeFormItemRowProps {
  index: number;
  item: OutcomeFormItemState;
  activeProducts: Product[];
  selectedProduct?: Product;
  allItems: OutcomeFormItemState[];
  errors: Record<string, string>;
  disabled?: boolean;
  historicalPrice?: HistoricalPriceResult;
  priceStatus?: 'idle' | 'loading' | 'ready' | 'error';
  onProductChange: (rowId: string, newProductId: string) => void;
  onQuantityChange: (rowId: string, val: string) => void;
  onRemove: (rowId: string) => void;
}

export const OutcomeFormItemRow = ({
  index,
  item,
  activeProducts,
  selectedProduct,
  allItems,
  errors,
  disabled = false,
  historicalPrice,
  priceStatus = 'ready',
  onProductChange,
  onQuantityChange,
  onRemove,
}: OutcomeFormItemRowProps) => {
  const isPriceLoading = Boolean(selectedProduct && priceStatus === 'loading');
  const isPriceError = Boolean(selectedProduct && (priceStatus === 'error' || (!historicalPrice && priceStatus === 'ready')));

  const purchasePrice = selectedProduct && historicalPrice
    ? historicalPrice.purchasePrice
    : null;

  const subtotal = purchasePrice !== null
    ? calculateOutcomeSubtotal(item.rawQuantity, purchasePrice)
    : null;

  const prodErr = errors[`item-${item.id}-product`];
  const qtyErr = errors[`item-${item.id}-qty`];

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
          disabled={disabled}
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
                {isChosenElsewhere ? ' — [уже в документе]' : ''}
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

      {/* 2. Available stock (read-only) */}
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

      {/* 3. Quantity to write off */}
      <div className={styles.itemColQty}>
        <label htmlFor={`item-qty-${item.id}`} className={styles.miniLabel}>
          Кол-во
        </label>
        <input
          id={`item-qty-${item.id}`}
          type="text"
          inputMode="numeric"
          className={styles.itemInput}
          placeholder="Кол-во"
          value={item.rawQuantity}
          disabled={disabled}
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

      {/* 4. Unit purchase price (read-only historical price) */}
      <div className={styles.itemColPrice}>
        <span className={styles.miniLabel}>Себестоимость</span>
        <div className={styles.itemReadOnlyVal}>
          {isPriceLoading ? (
            <span className={styles.priceLoading}>Загрузка...</span>
          ) : isPriceError ? (
            <span title="Не удалось загрузить историю цен">—</span>
          ) : purchasePrice !== null ? (
            <>
              {formatCurrency(purchasePrice)}
              {historicalPrice?.source === 'catalog_fallback' && (
                <span
                  className={styles.sourceTag}
                  title="Используется текущая базовая цена каталога"
                >
                  (баз.)
                </span>
              )}
            </>
          ) : (
            '—'
          )}
        </div>
      </div>

      {/* 5. Subtotal cost (quantity * purchasePrice) */}
      <div className={styles.itemColTotal}>
        <span className={styles.miniLabel}>Сумма</span>
        <div className={styles.itemTotalVal}>
          {isPriceLoading ? (
            <span className={styles.priceLoading}>…</span>
          ) : subtotal !== null ? (
            formatCurrency(subtotal)
          ) : (
            '—'
          )}
        </div>
      </div>

      {/* 6. Delete row button */}
      <div className={styles.itemColAction}>
        <button
          type="button"
          className={styles.deleteRowBtn}
          disabled={disabled}
          onClick={() => onRemove(item.id)}
          aria-label={`Удалить позицию ${index + 1}`}
          title="Удалить позицию"
        >
          <Trash2 size={16} />
        </button>
      </div>

    </div>
  );
};
