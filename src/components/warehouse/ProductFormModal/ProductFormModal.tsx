import { useState, useEffect, useRef, type FormEvent } from 'react';
import { X, AlertCircle } from 'lucide-react';
import type { Product, ProductCategory, ProductFormData } from '../../../types';
import { restoreFocusWithFallback } from '../../../utils/focusUtils';
import styles from './ProductFormModal.module.scss';

export interface ProductFormModalProps {
  isOpen: boolean;
  productToEdit?: Product | null;
  existingProducts: Product[];
  onClose: () => void;
  onSubmit: (
    data: ProductFormData
  ) => { success: boolean; error?: string; field?: 'stock' | 'purchasePrice' } | void;
}

interface ProductFormRawState {
  name: string;
  sku: string;
  barcode: string;
  category: ProductCategory;
  description: string;
  purchasePrice: string;
  sellingPrice: string;
  stock: string;
  minStockThreshold: string;
}

export const ProductFormModal = ({
  isOpen,
  productToEdit,
  existingProducts,
  onClose,
  onSubmit,
}: ProductFormModalProps) => {
  const modalRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  // Initialize state directly with strings to prevent partial inputs from coercing to 0
  const [formData, setFormData] = useState<ProductFormRawState>(() => {
    if (productToEdit) {
      return {
        name: productToEdit.name,
        sku: productToEdit.sku,
        barcode: productToEdit.barcode,
        category: productToEdit.category,
        description: productToEdit.description || '',
        purchasePrice: String(productToEdit.purchasePrice),
        sellingPrice: String(productToEdit.sellingPrice),
        minStockThreshold: String(productToEdit.minStockThreshold),
        stock: String(productToEdit.stock),
      };
    }
    const nextId = existingProducts.length + 1;
    return {
      name: '',
      sku: `SS-NEW-${String(nextId).padStart(3, '0')}`,
      barcode: `470001001${String(nextId).padStart(3, '0')}`,
      category: 'cases',
      description: '',
      purchasePrice: '',
      sellingPrice: '',
      minStockThreshold: '10',
      stock: '0',
    };
  });

  const [errors, setErrors] = useState<Record<string, string>>({});

  // Focus trap, initial focus, and cleanup focus restoration
  useEffect(() => {
    if (!isOpen) return;

    // Capture active element before opening
    if (document.activeElement instanceof HTMLElement) {
      previousFocusRef.current = document.activeElement;
    }

    document.body.classList.add('drawer-open');

    // Immediate focus on first input without setTimeout
    const firstInput = modalRef.current?.querySelector<HTMLInputElement>('#prod-name');
    firstInput?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }

      if (e.key === 'Tab' && modalRef.current) {
        const focusable = modalRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length === 0) return;

        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.classList.remove('drawer-open');
      window.removeEventListener('keydown', handleKeyDown);

      // Reliable focus restoration in cleanup
      restoreFocusWithFallback(previousFocusRef.current);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const validate = (): { isValid: boolean; data?: ProductFormData } => {
    const newErrors: Record<string, string> = {};

    const normName = formData.name.trim();
    const normSku = formData.sku.trim().toUpperCase();
    const normBarcode = formData.barcode.trim();
    const normDesc = formData.description.trim();

    if (!normName) {
      newErrors.name = 'Обязательное поле';
    }

    if (!normSku) {
      newErrors.sku = 'Обязательное поле';
    } else {
      const duplicateSku = existingProducts.find(
        (p) =>
          p.id !== productToEdit?.id &&
          p.sku.trim().toUpperCase() === normSku
      );
      if (duplicateSku) {
        newErrors.sku = 'Товар с таким артикулом уже существует';
      }
    }

    if (!normBarcode) {
      newErrors.barcode = 'Обязательное поле';
    } else {
      const duplicateBarcode = existingProducts.find(
        (p) =>
          p.id !== productToEdit?.id &&
          p.barcode.trim() === normBarcode
      );
      if (duplicateBarcode) {
        newErrors.barcode = 'Товар с таким штрихкодом уже существует';
      }
    }

    // Price validation: non-negative finite number with up to 2 decimal places, supports '.' or ','
    const validatePrice = (
      rawValue: string,
      fieldName: 'purchasePrice' | 'sellingPrice'
    ): number | null => {
      const trimmed = rawValue.trim();
      if (!trimmed) {
        newErrors[fieldName] = 'Обязательное поле';
        return null;
      }

      const normalized = trimmed.replace(',', '.');
      // Prohibit exponential notation, signs, NaN, Infinity
      const priceRegex = /^\d+(\.\d{1,2})?$/;
      if (!priceRegex.test(normalized)) {
        newErrors[fieldName] = 'Введите число >= 0 (максимум 2 знака после запятой)';
        return null;
      }

      const num = Number(normalized);
      if (!Number.isFinite(num) || Number.isNaN(num) || num < 0 || num > 100_000_000) {
        newErrors[fieldName] = 'Цена должна быть числом от 0 до 100 000 000 сом';
        return null;
      }

      return num;
    };

    // Quantity validation: whole non-negative integers only within safe range
    const validateInteger = (
      rawValue: string,
      fieldName: 'stock' | 'minStockThreshold'
    ): number | null => {
      const trimmed = rawValue.trim();
      if (!trimmed) {
        newErrors[fieldName] = 'Обязательное поле';
        return null;
      }

      const intRegex = /^\d+$/;
      if (!intRegex.test(trimmed)) {
        newErrors[fieldName] = 'Введите целое число >= 0';
        return null;
      }

      const num = Number(trimmed);
      if (!Number.isSafeInteger(num) || num < 0 || num > 100_000_000) {
        newErrors[fieldName] = 'Значение должно быть целым числом от 0 до 100 000 000';
        return null;
      }

      return num;
    };

    const parsedPurchasePrice = validatePrice(formData.purchasePrice, 'purchasePrice');
    const parsedSellingPrice = validatePrice(formData.sellingPrice, 'sellingPrice');
    const parsedStock = validateInteger(formData.stock, 'stock');
    const parsedMinStock = validateInteger(formData.minStockThreshold, 'minStockThreshold');

    // Selling price must not be lower than purchase price
    if (
      parsedPurchasePrice !== null &&
      parsedSellingPrice !== null &&
      parsedSellingPrice < parsedPurchasePrice
    ) {
      newErrors.sellingPrice = 'Цена продажи не должна быть ниже закупочной цены';
    }

    setErrors(newErrors);

    if (
      Object.keys(newErrors).length > 0 ||
      parsedPurchasePrice === null ||
      parsedSellingPrice === null ||
      parsedStock === null ||
      parsedMinStock === null
    ) {
      return { isValid: false };
    }

    return {
      isValid: true,
      data: {
        name: normName,
        sku: normSku,
        barcode: normBarcode,
        category: formData.category,
        description: normDesc,
        purchasePrice: parsedPurchasePrice,
        sellingPrice: parsedSellingPrice,
        stock: parsedStock,
        minStockThreshold: parsedMinStock,
      },
    };
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const result = validate();
    if (result.isValid && result.data) {
      const res = onSubmit(result.data);
      if (res && !res.success) {
        const err = res.error || 'Ошибка при сохранении товара';
        const fieldKey = res.field || (/остат|движени/i.test(err) ? 'stock' : 'purchasePrice');
        setErrors((prev) => ({
          ...prev,
          [fieldKey]: err,
        }));
        requestAnimationFrame(() => {
          const targetField = modalRef.current?.querySelector<HTMLElement>(
            fieldKey === 'stock' ? '#prod-stock' : '#prod-purchase'
          );
          targetField?.focus();
        });
        return;
      }
      onClose();
    } else {
      requestAnimationFrame(() => {
        const firstInvalid = modalRef.current?.querySelector<HTMLElement>(
          '[aria-invalid="true"]'
        );
        firstInvalid?.focus();
      });
    }
  };

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div
        className={styles.modalCard}
        ref={modalRef}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
      >
        <header className={styles.modalHeader}>
          <div>
            <h2 id="modal-title" className={styles.modalTitle}>
              {productToEdit ? 'Редактировать товар' : 'Добавить товар'}
            </h2>
            <p className={styles.modalSubtitle}>
              {productToEdit
                ? 'Измените параметры товара и сохраните обновления'
                : 'Заполните обязательные параметры для складского учёта'}
            </p>
          </div>
          <button
            type="button"
            className={styles.closeBtn}
            onClick={onClose}
            aria-label="Закрыть модальное окно"
          >
            <X size={20} />
          </button>
        </header>

        <form onSubmit={handleSubmit} className={styles.form} noValidate>
          <div className={styles.scrollableContent}>
            {/* Name */}
            <div className={styles.formGroup}>
              <label htmlFor="prod-name" className={styles.label}>
                Название товара <span className={styles.req}>*</span>
              </label>
              <input
                id="prod-name"
                type="text"
                className={`${styles.input} ${errors.name ? styles.inputError : ''}`}
                placeholder="Например: Чехол iPhone 15 Pro Silicone"
                value={formData.name}
                aria-invalid={errors.name ? 'true' : undefined}
                aria-describedby={errors.name ? 'prod-name-error' : undefined}
                onChange={(e) =>
                  setFormData({ ...formData, name: e.target.value })
                }
              />
              {errors.name && (
                <span id="prod-name-error" role="alert" className={styles.errorText}>
                  <AlertCircle size={12} /> {errors.name}
                </span>
              )}
            </div>

            {/* SKU and Barcode in 2 columns */}
            <div className={styles.twoCol}>
              <div className={styles.formGroup}>
                <label htmlFor="prod-sku" className={styles.label}>
                  Артикул <span className={styles.req}>*</span>
                </label>
                <input
                  id="prod-sku"
                  type="text"
                  className={`${styles.input} ${errors.sku ? styles.inputError : ''}`}
                  placeholder="SS-IP15P-001"
                  value={formData.sku}
                  aria-invalid={errors.sku ? 'true' : undefined}
                  aria-describedby={errors.sku ? 'prod-sku-error' : undefined}
                  onChange={(e) =>
                    setFormData({ ...formData, sku: e.target.value })
                  }
                />
                {errors.sku && (
                  <span id="prod-sku-error" role="alert" className={styles.errorText}>
                    <AlertCircle size={12} /> {errors.sku}
                  </span>
                )}
              </div>

              <div className={styles.formGroup}>
                <label htmlFor="prod-barcode" className={styles.label}>
                  Штрихкод <span className={styles.req}>*</span>
                </label>
                <input
                  id="prod-barcode"
                  type="text"
                  className={`${styles.input} ${errors.barcode ? styles.inputError : ''}`}
                  placeholder="470001001001"
                  value={formData.barcode}
                  aria-invalid={errors.barcode ? 'true' : undefined}
                  aria-describedby={errors.barcode ? 'prod-barcode-error' : undefined}
                  onChange={(e) =>
                    setFormData({ ...formData, barcode: e.target.value })
                  }
                />
                {errors.barcode && (
                  <span id="prod-barcode-error" role="alert" className={styles.errorText}>
                    <AlertCircle size={12} /> {errors.barcode}
                  </span>
                )}
              </div>
            </div>

            {/* Category */}
            <div className={styles.formGroup}>
              <label htmlFor="prod-category" className={styles.label}>
                Категория <span className={styles.req}>*</span>
              </label>
              <select
                id="prod-category"
                className={styles.select}
                value={formData.category}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    category: e.target.value as ProductCategory,
                  })
                }
              >
                <option value="cases">Чехлы</option>
                <option value="cables">Кабели</option>
                <option value="glass">Защитные стёкла</option>
                <option value="powerbanks">Power Bank</option>
                <option value="headphones">Наушники</option>
                <option value="adapters">Адаптеры</option>
                <option value="memory">Карты памяти</option>
                <option value="holders">Автодержатели</option>
              </select>
            </div>

            {/* Description */}
            <div className={styles.formGroup}>
              <label htmlFor="prod-desc" className={styles.label}>
                Краткое описание
              </label>
              <input
                id="prod-desc"
                type="text"
                className={styles.input}
                placeholder="Силиконовый чехол soft-touch, быстрая зарядка и т.д."
                value={formData.description}
                onChange={(e) =>
                  setFormData({ ...formData, description: e.target.value })
                }
              />
            </div>

            {/* Prices */}
            <div className={styles.twoCol}>
              <div className={styles.formGroup}>
                <label htmlFor="prod-purchase" className={styles.label}>
                  Закупочная цена (сом) <span className={styles.req}>*</span>
                </label>
                <input
                  id="prod-purchase"
                  type="text"
                  inputMode="decimal"
                  className={`${styles.input} ${errors.purchasePrice ? styles.inputError : ''}`}
                  value={formData.purchasePrice}
                  placeholder="0.00"
                  aria-invalid={errors.purchasePrice ? 'true' : undefined}
                  aria-describedby={errors.purchasePrice ? 'prod-purchase-error' : undefined}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      purchasePrice: e.target.value,
                    })
                  }
                />
                {errors.purchasePrice && (
                  <span id="prod-purchase-error" role="alert" className={styles.errorText}>
                    <AlertCircle size={12} /> {errors.purchasePrice}
                  </span>
                )}
              </div>

              <div className={styles.formGroup}>
                <label htmlFor="prod-selling" className={styles.label}>
                  Цена продажи (сом) <span className={styles.req}>*</span>
                </label>
                <input
                  id="prod-selling"
                  type="text"
                  inputMode="decimal"
                  className={`${styles.input} ${errors.sellingPrice ? styles.inputError : ''}`}
                  value={formData.sellingPrice}
                  placeholder="0.00"
                  aria-invalid={errors.sellingPrice ? 'true' : undefined}
                  aria-describedby={errors.sellingPrice ? 'prod-selling-error' : undefined}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      sellingPrice: e.target.value,
                    })
                  }
                />
                {errors.sellingPrice && (
                  <span id="prod-selling-error" role="alert" className={styles.errorText}>
                    <AlertCircle size={12} /> {errors.sellingPrice}
                  </span>
                )}
              </div>
            </div>

            {/* Quantities */}
            <div className={styles.twoCol}>
              <div className={styles.formGroup}>
                <label htmlFor="prod-stock" className={styles.label}>
                  {productToEdit ? 'Текущий остаток (шт.)' : 'Начальный остаток (шт.)'}{' '}
                  <span className={styles.req}>*</span>
                </label>
                <input
                  id="prod-stock"
                  type="text"
                  inputMode="numeric"
                  className={`${styles.input} ${errors.stock ? styles.inputError : ''}`}
                  value={formData.stock}
                  placeholder="0"
                  aria-invalid={errors.stock ? 'true' : undefined}
                  aria-describedby={errors.stock ? 'prod-stock-error' : undefined}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      stock: e.target.value,
                    })
                  }
                />
                {errors.stock && (
                  <span id="prod-stock-error" role="alert" className={styles.errorText}>
                    <AlertCircle size={12} /> {errors.stock}
                  </span>
                )}
              </div>

              <div className={styles.formGroup}>
                <label htmlFor="prod-min-stock" className={styles.label}>
                  Минимальный порог (шт.) <span className={styles.req}>*</span>
                </label>
                <input
                  id="prod-min-stock"
                  type="text"
                  inputMode="numeric"
                  className={`${styles.input} ${errors.minStockThreshold ? styles.inputError : ''}`}
                  value={formData.minStockThreshold}
                  placeholder="10"
                  aria-invalid={errors.minStockThreshold ? 'true' : undefined}
                  aria-describedby={errors.minStockThreshold ? 'prod-min-stock-error' : undefined}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      minStockThreshold: e.target.value,
                    })
                  }
                />
                {errors.minStockThreshold && (
                  <span id="prod-min-stock-error" role="alert" className={styles.errorText}>
                    <AlertCircle size={12} /> {errors.minStockThreshold}
                  </span>
                )}
              </div>
            </div>
          </div>

          <footer className={styles.modalFooter}>
            <button
              type="button"
              className={styles.cancelBtn}
              onClick={onClose}
            >
              Отмена
            </button>
            <button
              type="submit"
              className={styles.submitBtn}
            >
              {productToEdit ? 'Сохранить изменения' : 'Добавить товар'}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
};
