import type { PostgrestError } from '@supabase/supabase-js';
import type { MappedWarehouseError } from '../../types';

export type { MappedWarehouseError };

/**
 * Maps PostgreSQL and Supabase errors to safe, user-friendly Russian messages
 * without exposing internal SQL, database structure, constraints, or stack traces.
 */
export const mapWarehouseError = (error: unknown): MappedWarehouseError => {
  if (!error) {
    return { message: 'Произошла непредвиденная ошибка. Попробуйте ещё раз.' };
  }

  // Network / fetch errors
  if (error instanceof TypeError && error.message.toLowerCase().includes('failed to fetch')) {
    return { message: 'Ошибка сети. Проверьте подключение к интернету и повторите попытку.' };
  }

  const errObj = error as Partial<PostgrestError> & { message?: string; status?: number; code?: string };
  const message = typeof errObj.message === 'string' ? errObj.message : '';
  const code = typeof errObj.code === 'string' ? errObj.code : '';

  // 1. Unique constraint violations (code 23505)
  if (code === '23505' || message.includes('already exists') || message.includes('уже существует')) {
    const lower = message.toLowerCase();
    if (lower.includes('sku') || lower.includes('артикул')) {
      return {
        message: 'Товар с таким артикулом уже существует.',
        field: 'sku',
      };
    }
    if (lower.includes('barcode') || lower.includes('штрихкод')) {
      return {
        message: 'Товар с таким штрихкодом уже существует.',
        field: 'barcode',
      };
    }
    return { message: 'Запись с такими уникальными реквизитами уже существует.' };
  }

  // 2. Permission / unauthorized errors (code 42501, 28000, 401, JWT expired)
  if (
    code === '42501' ||
    code === '28000' ||
    errObj.status === 401 ||
    message.includes('401') ||
    message.includes('JWT') ||
    message.includes('Forbidden') ||
    message.includes('Unauthorized') ||
    message.includes('administrator privileges')
  ) {
    if (errObj.status === 401 || message.includes('401') || message.includes('JWT')) {
      return { message: 'Сессия истекла или требуется повторная авторизация. Пожалуйста, выполните вход заново.' };
    }
    return { message: 'Недостаточно прав для выполнения данной операции.' };
  }

  // 3. Not found errors (code P0002)
  if (code === 'P0002' || message.includes('not found') || message.includes('не найден')) {
    return { message: 'Товар не найден в базе данных. Возможно, он был удалён или перемещён.' };
  }

  // 4. Archive with positive stock violation
  if (
    message.includes('Cannot archive product') && message.includes('positive stock') ||
    message.includes('положительный остаток')
  ) {
    return {
      message: 'Невозможно архивировать товар с ненулевым остатком на складе. Сначала оформите списание или расход.',
      field: 'stock',
    };
  }

  // 5. Archived product stock adjustment
  if (message.includes('archived product') || message.includes('архивирован')) {
    return { message: 'Невозможно изменить остаток у архивированного товара.' };
  }

  // 6. Negative historical balance
  if (message.includes('negative historical balance') || message.includes('negative subsequent')) {
    return {
      message: 'Корректировка остатка приведет к отрицательному балансу в хронологии движений.',
      field: 'stock',
    };
  }

  // 7. Selling price < purchase price
  if (
    message.includes('Selling price') && message.includes('cannot be less than purchase price') ||
    message.includes('Цена продажи не должна быть ниже')
  ) {
    return {
      message: 'Цена продажи не может быть ниже закупочной цены.',
      field: 'sellingPrice',
    };
  }

  // 8. Empty fields validation from RPC
  if (message.includes('SKU cannot be empty')) {
    return { message: 'Артикул не может быть пустым.', field: 'sku' };
  }
  if (message.includes('Barcode cannot be empty')) {
    return { message: 'Штрихкод не может быть пустым.', field: 'barcode' };
  }
  if (message.includes('Product name cannot be empty')) {
    return { message: 'Название товара не может быть пустым.', field: 'name' };
  }
  if (message.includes('Reason for stock adjustment cannot be empty')) {
    return { message: 'Укажите обязательную причину корректировки остатка.', field: 'reason' };
  }

  // Fallback for general errors
  return { message: 'Произошла ошибка при сохранении данных. Пожалуйста, повторите попытку.' };
};
