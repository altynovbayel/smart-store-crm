import type { Product } from '../types';
import { getStockStatusLabel } from './productUtils';

/**
 * Безопасная обработка текстовой CSV-ячейки для предотвращения CSV/Formula Injection.
 * Опасными считаются символы: =, +, -, @, символ табуляции (\t), carriage return (\r),
 * с учётом возможных пробельных символов в начале строки.
 * Если строка потенциально является формулой:
 * - перед исходным значением добавляется одинарная кавычка (');
 * - выполняется стандартное CSV-экранирование (двойные кавычки удваиваются);
 * - итоговое значение оборачивается в двойные кавычки.
 */
export const sanitizeCSVText = (value: string): string => {
  const isFormula = /^\s*[=+\-@\t\r]/.test(value);
  const safeValue = isFormula ? `'${value}` : value;
  return `"${safeValue.replace(/"/g, '""')}"`;
};

/**
 * Форматирует значение ячейки для CSV:
 * - Числовые значения остаются числами без одинарной кавычки и без оборачивания.
 * - Текстовые значения защищаются от формульных инъекций и экранируются в двойные кавычки.
 * - null/undefined форматируются как пустая строка в кавычках.
 */
export const formatCSVCell = (value: string | number | undefined | null): string => {
  if (value === undefined || value === null) {
    return '""';
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : '0';
  }

  return sanitizeCSVText(value);
};

export const escapeCSVValue = formatCSVCell;

/**
 * Exports products to a CSV file with UTF-8 BOM for proper Cyrillic rendering in Excel.
 * User-entered strings are protected from formula execution (CSV Injection).
 */
export const exportProductsToCSV = (
  products: Product[],
  fileName = 'smart-store-sklad.csv'
): void => {
  const headers = [
    'Артикул',
    'Штрихкод',
    'Название',
    'Категория',
    'Описание',
    'Закупочная цена (сом)',
    'Цена продажи (сом)',
    'Остаток',
    'Мин. остаток',
    'Статус',
  ];

  const rows = products.map((p) => [
    p.sku,
    p.barcode,
    p.name,
    p.categoryLabel,
    p.description || '',
    p.purchasePrice,
    p.sellingPrice,
    p.stock,
    p.minStockThreshold,
    getStockStatusLabel(p.status),
  ]);

  const csvContent =
    '\uFEFF' +
    [
      headers.map(sanitizeCSVText).join(';'),
      ...rows.map((row) => row.map(formatCSVCell).join(';')),
    ].join('\r\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');

  link.setAttribute('href', url);
  link.setAttribute('download', fileName);
  link.style.display = 'none';

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  URL.revokeObjectURL(url);
};
