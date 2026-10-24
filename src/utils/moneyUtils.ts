/**
 * Utility functions for converting between Kyrgyz Som (som) and minor units (tyiyns).
 * 1 Som = 100 Tyiyns.
 * Strictly uses integer arithmetic and Number.isSafeInteger checks to prevent
 * IEEE-754 precision loss and NaN/Infinity values.
 */

export const SOM_TO_MINOR_FACTOR = 100;
export const MAX_SAFE_PRICE_SOM = 100_000_000; // 100 million Som
export const MAX_SAFE_PRICE_MINOR = 10_000_000_000; // 10 billion Tyiyns (fits safely in JS 2^53 - 1)

/**
 * Converts Som amount to minor units (tyiyns).
 * @param som Non-negative number in Som
 * @returns Non-negative safe integer in Tyiyns
 */
export const somToMinor = (som: number): number => {
  if (!Number.isFinite(som) || Number.isNaN(som) || som < 0) {
    throw new Error(`Недопустимое значение цены в сомах: ${som}`);
  }
  if (som > MAX_SAFE_PRICE_SOM) {
    throw new Error(`Цена превышает максимальный лимит 100 000 000 сом: ${som}`);
  }
  const minor = Math.round(som * SOM_TO_MINOR_FACTOR);
  if (!Number.isSafeInteger(minor) || minor < 0 || minor > MAX_SAFE_PRICE_MINOR) {
    throw new Error(`Превышение безопасного диапазона целых чисел в тыйынах: ${minor}`);
  }
  return minor;
};

/**
 * Converts minor units (tyiyns) to Som.
 * @param minor Non-negative safe integer in Tyiyns
 * @returns Non-negative number in Som
 */
export const minorToSom = (minor: number): number => {
  if (!Number.isSafeInteger(minor) || minor < 0) {
    throw new Error(`Недопустимое значение в тыйынах: ${minor}`);
  }
  return minor / SOM_TO_MINOR_FACTOR;
};
