import {
  useState,
  useEffect,
  useId,
  useRef,
  type ChangeEvent,
  type KeyboardEvent,
  type RefObject,
} from 'react';
import type { ProductPickResult, SearchableProduct } from '../types';
import { findProductsByExactBarcode, searchProducts } from '../utils/productSearch';

export const PRODUCT_NOT_FOUND_MESSAGE = 'Товар не найден';
const DUPLICATE_BARCODE_MESSAGE =
  'Найдено несколько товаров с этим штрихкодом. Выберите нужный товар из списка.';
const CHOOSE_FROM_LIST_MESSAGE =
  'Точного совпадения штрихкода нет. Выберите товар из списка стрелками ↑/↓ и нажмите Enter.';

export interface ProductSearchFeedback {
  kind: 'success' | 'error';
  text: string;
  /** Changes on every message so a repeated text is announced again by screen readers. */
  id: number;
}

interface UseProductSearchPickerOptions<T extends SearchableProduct> {
  /** Already loaded active catalog of the form (no extra requests are made). */
  products: readonly T[];
  /** Blocks picking (document is being conducted). */
  disabled: boolean;
  /** Applies the product to the document; the field is cleared only on success. */
  onPick: (product: T) => ProductPickResult;
}

export interface ProductSearchPicker<T extends SearchableProduct> {
  inputRef: RefObject<HTMLInputElement | null>;
  listboxId: string;
  getOptionId: (index: number) => string;
  query: string;
  results: T[];
  totalMatches: number;
  hasProducts: boolean;
  isListOpen: boolean;
  activeIndex: number;
  feedback: ProductSearchFeedback | null;
  disabled: boolean;
  onChange: (e: ChangeEvent<HTMLInputElement>) => void;
  onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void;
  onFocus: () => void;
  onBlur: () => void;
  setActiveIndex: (index: number) => void;
  pickProduct: (product: T) => void;
}

/**
 * Shared "search or scan" behaviour of the Income and Outcome document forms.
 * - Search by name / SKU / barcode, case-insensitive, trimmed; archived products are excluded.
 * - A hardware scanner types the code and sends Enter: Enter never submits the form. An explicitly
 *   highlighted result wins, otherwise an exact barcode match is picked; nothing is picked by a
 *   mere substring match (a partial code must not add a wrong product).
 * - After a successful pick the field is cleared and keeps focus, so the next code can be scanned
 *   right away; after a refusal the value stays selected and the next scan replaces it.
 * - ArrowDown / ArrowUp move through the results, Home / End jump to the first / last one while
 *   an option is highlighted (otherwise they move the caret in the text).
 * - Escape closes the result list without closing the dialog; a second Escape closes the dialog.
 */
export const useProductSearchPicker = <T extends SearchableProduct>({
  products,
  disabled,
  onPick,
}: UseProductSearchPickerOptions<T>): ProductSearchPicker<T> => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const feedbackIdRef = useRef(0);
  const baseId = useId();
  const listboxId = `${baseId}-listbox`;

  const [query, setQuery] = useState('');
  const [isListOpen, setIsListOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [feedback, setFeedback] = useState<ProductSearchFeedback | null>(null);

  const { results, totalMatches } = searchProducts(products, query);
  const safeActiveIndex = activeIndex < results.length ? activeIndex : -1;

  useEffect(
    () => () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    },
    []
  );

  // Keep the highlighted option visible inside the scrollable list
  useEffect(() => {
    if (!isListOpen || safeActiveIndex < 0) return;
    document
      .getElementById(`${listboxId}-opt-${safeActiveIndex}`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [isListOpen, safeActiveIndex, listboxId]);

  const showFeedback = (kind: ProductSearchFeedback['kind'], text: string) => {
    feedbackIdRef.current += 1;
    setFeedback({ kind, text, id: feedbackIdRef.current });
  };

  const focusInput = (selectText: boolean) => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const input = inputRef.current;
      if (input && document.contains(input) && !input.disabled) {
        input.focus();
        if (selectText) input.select();
      }
    });
  };

  const showError = (text: string) => {
    showFeedback('error', text);
    focusInput(true);
  };

  const pickProduct = (product: T) => {
    if (disabled) return;
    const res = onPick(product);
    if (res.ok) {
      setQuery('');
      setActiveIndex(-1);
      setIsListOpen(false);
      showFeedback('success', res.message);
      focusInput(false);
    } else {
      setIsListOpen(false);
      showError(res.error);
    }
  };

  const handleEnter = () => {
    if (disabled) return;
    const trimmed = query.trim();
    if (!trimmed) return;

    if (isListOpen && safeActiveIndex >= 0) {
      pickProduct(results[safeActiveIndex]);
      return;
    }

    const exact = findProductsByExactBarcode(products, trimmed);
    if (exact.length === 1) {
      pickProduct(exact[0]);
      return;
    }

    if (exact.length > 1) {
      setIsListOpen(true);
      showError(DUPLICATE_BARCODE_MESSAGE);
    } else if (results.length > 0) {
      setIsListOpen(true);
      showError(CHOOSE_FROM_LIST_MESSAGE);
    } else {
      setIsListOpen(false);
      showError(PRODUCT_NOT_FOUND_MESSAGE);
    }
  };

  const moveActive = (delta: 1 | -1) => {
    if (results.length === 0) return;
    setIsListOpen(true);
    if (!isListOpen || safeActiveIndex < 0) {
      setActiveIndex(delta === 1 ? 0 : results.length - 1);
      return;
    }
    setActiveIndex((safeActiveIndex + delta + results.length) % results.length);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    switch (e.key) {
      case 'Enter':
        // Scanners terminate with Enter: never submit the surrounding document form
        e.preventDefault();
        e.stopPropagation();
        handleEnter();
        break;
      case 'ArrowDown':
        e.preventDefault();
        moveActive(1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        moveActive(-1);
        break;
      case 'Home':
      case 'End':
        // While navigating the open list: first / last result; otherwise the caret moves in the text
        if (isListOpen && safeActiveIndex >= 0 && results.length > 0) {
          e.preventDefault();
          setActiveIndex(e.key === 'Home' ? 0 : results.length - 1);
        }
        break;
      case 'Escape':
        // Close the list first; the dialog's Escape handler only sees the next Escape
        if (isListOpen && query.trim()) {
          e.preventDefault();
          e.stopPropagation();
          setIsListOpen(false);
          setActiveIndex(-1);
        }
        break;
      default:
        break;
    }
  };

  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    setQuery(e.target.value);
    setActiveIndex(-1);
    setIsListOpen(true);
    if (feedback?.kind === 'error') setFeedback(null);
  };

  return {
    inputRef,
    listboxId,
    getOptionId: (index: number) => `${listboxId}-opt-${index}`,
    query,
    results,
    totalMatches,
    hasProducts: products.some((p) => p.isArchived !== true),
    isListOpen: isListOpen && query.trim() !== '',
    activeIndex: safeActiveIndex,
    feedback,
    disabled,
    onChange,
    onKeyDown,
    onFocus: () => setIsListOpen(true),
    onBlur: () => {
      setIsListOpen(false);
      setActiveIndex(-1);
    },
    setActiveIndex,
    pickProduct,
  };
};
