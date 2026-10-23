import { useState, useEffect, useRef, type RefObject } from 'react';
import type { SaleCatalogProduct, SaleFormItemState } from '../../../types';
import { processBarcodeScan } from '../../../utils/saleCalculations';

interface UseSaleBarcodeScannerOptions {
  isOpen: boolean;
  activeProducts: readonly SaleCatalogProduct[];
  items: SaleFormItemState[];
  isSubmittingRef: RefObject<boolean>;
  /** Applies scanned rows (new row, filled empty row or incremented quantity). */
  onItemsScanned: (items: SaleFormItemState[]) => void;
}

/**
 * Hardware barcode scanner state for the sale form.
 * - Exact barcode match after trim among ACTIVE Supabase products (archived → "не найден").
 * - Re-scanning increments the quantity within the available stock.
 * - Success clears the field; an error keeps and selects the value; focus always returns to the field.
 * - Scans are ignored while the sale is being conducted.
 */
export const useSaleBarcodeScanner = ({
  isOpen,
  activeProducts,
  items,
  isSubmittingRef,
  onItemsScanned,
}: UseSaleBarcodeScannerOptions) => {
  const barcodeInputRef = useRef<HTMLInputElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const [barcode, setBarcode] = useState('');
  const [barcodeError, setBarcodeError] = useState<string | null>(null);
  const [barcodeSuccess, setBarcodeSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [isOpen]);

  const focusScanner = (selectText: boolean) => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
    }
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const input = barcodeInputRef.current;
      if (input && document.contains(input)) {
        input.focus();
        if (selectText) input.select();
      }
    });
  };

  const handleBarcodeChange = (val: string) => {
    setBarcode(val);
    if (barcodeError) {
      setBarcodeError(null);
    }
  };

  const handleBarcodeScan = (scannedValue: string) => {
    if (isSubmittingRef.current) return;
    const trimmed = scannedValue.trim();
    if (!trimmed) return;

    const res = processBarcodeScan(trimmed, activeProducts, items);

    if (res.success && res.updatedItems) {
      onItemsScanned(res.updatedItems);
      setBarcode('');
      setBarcodeError(null);
      setBarcodeSuccess(res.message ?? 'Товар добавлен в чек');
      focusScanner(false);
    } else if (!res.success && res.error) {
      setBarcodeError(res.error);
      setBarcodeSuccess(null);
      focusScanner(true);
    }
  };

  return {
    barcodeInputRef,
    barcode,
    barcodeError,
    barcodeSuccess,
    handleBarcodeChange,
    handleBarcodeScan,
  };
};
