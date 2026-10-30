import { ScanBarcode, CheckCircle2, AlertCircle } from 'lucide-react';
import type { SearchableProduct } from '../../../types';
import type { ProductSearchPicker } from '../../../hooks/useProductSearchPicker';
import styles from './ProductSearchField.module.scss';

export interface ProductSearchFieldProps<T extends SearchableProduct> {
  /** Unique id of the input inside the page (label / hint / message ids derive from it). */
  inputId: string;
  picker: ProductSearchPicker<T>;
}

/**
 * "Search or scan" combobox of the document forms (Income / Outcome).
 * Keyboard: ArrowDown / ArrowUp (Home / End) move through results, Enter adds, Escape closes the list.
 * Mouse: an option is picked on click without moving focus out of the field.
 * Success messages are announced politely (role="status"), refusals as alerts.
 */
export const ProductSearchField = <T extends SearchableProduct>({
  inputId,
  picker,
}: ProductSearchFieldProps<T>) => {
  const {
    inputRef,
    listboxId,
    getOptionId,
    query,
    results,
    totalMatches,
    hasProducts,
    isListOpen,
    activeIndex,
    feedback,
    disabled,
    onChange,
    onKeyDown,
    onFocus,
    onBlur,
    setActiveIndex,
    pickProduct,
  } = picker;

  const hintId = `${inputId}-hint`;
  const messageId = `${inputId}-message`;
  const isError = feedback?.kind === 'error';

  return (
    <div className={styles.searchSection}>
      <label htmlFor={inputId} className={styles.label}>
        Поиск товара или сканирование штрихкода
      </label>

      <div className={styles.comboWrapper}>
        <ScanBarcode size={18} className={styles.scanIcon} aria-hidden="true" />
        <input
          id={inputId}
          ref={inputRef}
          type="text"
          role="combobox"
          className={styles.searchInput}
          placeholder="Введите название, артикул, штрихкод или отсканируйте товар"
          value={query}
          disabled={disabled}
          onChange={onChange}
          onKeyDown={onKeyDown}
          onFocus={onFocus}
          onBlur={onBlur}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          enterKeyHint="enter"
          aria-autocomplete="list"
          aria-expanded={isListOpen}
          aria-controls={listboxId}
          aria-activedescendant={isListOpen && activeIndex >= 0 ? getOptionId(activeIndex) : undefined}
          aria-invalid={isError ? 'true' : undefined}
          aria-describedby={feedback ? `${hintId} ${messageId}` : hintId}
        />

        <ul
          id={listboxId}
          role="listbox"
          aria-label="Найденные товары"
          className={styles.resultsList}
          hidden={!isListOpen}
        >
          {results.map((product, index) => (
            <li
              key={product.id}
              id={getOptionId(index)}
              role="option"
              aria-selected={index === activeIndex}
              className={`${styles.option} ${index === activeIndex ? styles.optionActive : ''}`}
              // Keep focus in the field so scanning can continue after a mouse pick
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => pickProduct(product)}
            >
              <span className={styles.optionName}>{product.name}</span>
              <span className={styles.optionMeta}>
                <span>Арт.: {product.sku || '—'}</span>
                <span>ШК: {product.barcode || '—'}</span>
                <span>
                  Остаток: {product.stock} {product.unit}
                </span>
              </span>
            </li>
          ))}
          {results.length === 0 && (
            <li className={styles.emptyOption} role="presentation">
              {hasProducts ? 'Ничего не найдено' : 'В каталоге нет активных товаров'}
            </li>
          )}
          {totalMatches > results.length && (
            <li className={styles.moreOption} role="presentation">
              Показаны первые {results.length} из {totalMatches}. Уточните запрос.
            </li>
          )}
        </ul>
      </div>

      <span id={hintId} className={styles.hint}>
        Сканер: наведите курсор в это поле и отсканируйте штрихкод
      </span>

      {/* Persistent live regions: the keyed child remounts so repeated messages are re-announced */}
      <div role="status" aria-live="polite" className={styles.liveRegion}>
        {feedback?.kind === 'success' && (
          <span key={feedback.id} id={messageId} className={styles.success}>
            <CheckCircle2 size={14} aria-hidden="true" />
            <span>{feedback.text}</span>
          </span>
        )}
      </div>
      <div role="alert" className={styles.liveRegion}>
        {isError && (
          <span key={feedback.id} id={messageId} className={styles.error}>
            <AlertCircle size={14} aria-hidden="true" />
            <span>{feedback.text}</span>
          </span>
        )}
      </div>
    </div>
  );
};
