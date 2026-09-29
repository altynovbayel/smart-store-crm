/**
 * Formats a numeric amount into Russian locale string with currency symbol
 * e.g. 2840500 -> "2 840 500 сом"
 */
export const formatCurrency = (amount: number): string => {
  return `${amount.toLocaleString('ru-RU')} сом`;
};

/**
 * Formats a number with thousands spaces
 * e.g. 1248 -> "1 248"
 */
export const formatNumber = (value: number): string => {
  return value.toLocaleString('ru-RU');
};
