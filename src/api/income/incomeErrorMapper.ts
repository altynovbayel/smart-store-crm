import type { PostgrestError } from '@supabase/supabase-js';
import type { MappedIncomeError } from '../../types';

export type { MappedIncomeError };

/**
 * Detects whether an error represents an unconfirmed network / transport failure
 * (e.g. client offline, DNS failure, aborted request, timeout, fetch failure)
 * regardless of whether it is an instance of TypeError, DOMException, or a plain JS object returned by Supabase.
 */
export const isNetworkTransportError = (error: unknown): boolean => {
  if (!error) return false;

  if (error instanceof TypeError) {
    const msg = error.message.toLowerCase();
    if (msg.includes('failed to fetch') || msg.includes('network') || msg.includes('load failed')) {
      return true;
    }
  }

  if (error instanceof DOMException) {
    if (error.name === 'AbortError' || error.name === 'TimeoutError') {
      return true;
    }
  }

  if (typeof error === 'object') {
    const errObj = error as {
      name?: string;
      message?: string;
      details?: string;
      status?: number;
      code?: string;
    };

    const name = String(errObj.name || '').toLowerCase();
    const msg = String(errObj.message || '').toLowerCase();
    const details = String(errObj.details || '').toLowerCase();
    const combined = `${name} ${msg} ${details}`;

    if (
      name === 'typeerror' &&
      (msg.includes('fetch') || msg.includes('network') || msg.includes('load failed'))
    ) {
      return true;
    }

    if (
      name.includes('abort') ||
      name.includes('timeout') ||
      combined.includes('abort') ||
      combined.includes('timeout') ||
      combined.includes('failed to fetch') ||
      combined.includes('networkerror') ||
      combined.includes('network error') ||
      combined.includes('network request failed') ||
      combined.includes('load failed') ||
      combined.includes('fetch failed') ||
      combined.includes('offline') ||
      combined.includes('net::err') ||
      combined.includes('bad gateway') ||
      combined.includes('gateway timeout') ||
      combined.includes('service unavailable') ||
      combined.includes('cloudflare') ||
      errObj.status === 0 ||
      errObj.status === 502 ||
      errObj.status === 503 ||
      errObj.status === 504 ||
      (errObj.status !== undefined && errObj.status >= 520 && errObj.status <= 524) ||
      errObj.code === 'ECONNREFUSED' ||
      errObj.code === 'ETIMEDOUT' ||
      errObj.code === 'ABORT_ERR' ||
      errObj.code === '20'
    ) {
      return true;
    }
  }

  return false;
};

/**
 * Maps PostgreSQL and Supabase errors to safe, user-friendly Russian messages
 * without exposing internal SQL, database structure, constraints, or stack traces.
 */
export const mapIncomeError = (error: unknown): MappedIncomeError => {
  if (!error) {
    return { message: 'Произошла непредвиденная ошибка. Попробуйте ещё раз.' };
  }

  // Network / transport errors
  if (isNetworkTransportError(error)) {
    const errObj = error as { status?: number };
    const status = errObj?.status;
    if (
      status === 502 ||
      status === 503 ||
      status === 504 ||
      (status !== undefined && status >= 520 && status <= 524)
    ) {
      return {
        message: 'Ошибка связи с сервером (шлюз недоступен). Проверьте интернет-соединение и повторите попытку.',
        isNetworkError: true,
      };
    }
    return {
      message: 'Ошибка сети. Проверьте подключение к интернету и повторите попытку.',
      isNetworkError: true,
    };
  }

  const errObj = error as Partial<PostgrestError> & {
    message?: string;
    status?: number;
    code?: string;
    details?: string;
  };
  const message = typeof errObj.message === 'string' ? errObj.message : '';
  const details = typeof errObj.details === 'string' ? errObj.details : '';
  const combined = `${message} ${details}`;
  const code = typeof errObj.code === 'string' ? errObj.code : '';

  // 1. Permission / unauthorized errors (code 42501, 28000, 401, 403, JWT expired)
  if (
    code === '42501' ||
    code === '28000' ||
    errObj.status === 401 ||
    errObj.status === 403 ||
    combined.includes('401') ||
    combined.includes('403') ||
    combined.includes('jwt') ||
    combined.includes('forbidden') ||
    combined.includes('unauthorized') ||
    combined.includes('administrator privileges')
  ) {
    if (
      errObj.status === 401 ||
      combined.includes('401') ||
      combined.includes('jwt') ||
      combined.includes('unauthorized')
    ) {
      return {
        message: 'Сессия истекла или требуется повторная авторизация. Пожалуйста, выполните вход заново.',
        isAuthError: true,
      };
    }
    return {
      message: 'Недостаточно прав для выполнения данной операции. Требуются права администратора.',
      isAuthError: true,
    };
  }

  // 2. Future date
  if (
    combined.includes('Receipt date cannot be in the future') ||
    combined.includes('date cannot be in the future') ||
    combined.includes('в будущем')
  ) {
    return {
      message: 'Дата прихода не может быть в будущем.',
      field: 'receivedAt',
    };
  }

  // 3. Empty supplier
  if (combined.includes('Supplier name cannot be empty') || combined.includes('поставщик')) {
    return {
      message: 'Укажите наименование поставщика.',
      field: 'supplier',
    };
  }

  // 4. Empty items array
  if (combined.includes('Receipt must contain at least one line item')) {
    return {
      message: 'Накладная должна содержать хотя бы одну позицию товара.',
      field: 'itemsGeneral',
    };
  }

  // 5. Duplicate product in items
  if (combined.includes('Duplicate product in income receipt items')) {
    return {
      message: 'Накладная содержит повторяющиеся товары. Объедините позиции.',
      field: 'itemsGeneral',
    };
  }

  // 6. Archived product
  if (combined.includes('Cannot receive archived product') || combined.includes('архивирован')) {
    return {
      message: 'Невозможно оприходовать архивированный товар. Восстановите товар на складе или выберите другой.',
      field: 'itemsGeneral',
    };
  }

  // 7. Product not found in catalog or record not found (PGRST116)
  if (
    code === 'P0002' ||
    code === 'PGRST116' ||
    combined.includes('products were not found in catalog') ||
    combined.includes('PGRST116') ||
    combined.includes('0 rows')
  ) {
    return {
      message: 'Приходная накладная или выбранные товары не найдены в базе данных.',
      field: 'itemsGeneral',
    };
  }

  // 8. Purchase price exceeds catalog selling price
  if (
    combined.includes('exceeds selling price') ||
    combined.includes('Incoming purchase price')
  ) {
    return {
      message: 'Закупочная цена позиции не может превышать текущую цену продажи товара в каталоге.',
      field: 'itemsGeneral',
    };
  }

  // 9. Backdating restrictions with prior sales / write-offs
  if (
    combined.includes('Cannot backdate income receipt') &&
    combined.includes('before existing sales')
  ) {
    return {
      message: 'Невозможно провести накладную задним числом с изменённой ценой: за этот период уже проведены продажи с прежней себестоимостью.',
      field: 'receivedAt',
    };
  }
  if (
    combined.includes('Cannot backdate income receipt') &&
    combined.includes('before existing write-off')
  ) {
    return {
      message: 'Невозможно провести накладную задним числом с изменённой ценой: за этот период уже проведены списания с прежней себестоимостью.',
      field: 'receivedAt',
    };
  }

  // 10. Quantity limit or price limit overflow
  if (combined.includes('Quantity must be positive and <= 100 000 000')) {
    return {
      message: 'Количество товара должно быть от 1 до 100 000 000 шт.',
      field: 'itemsGeneral',
    };
  }
  if (combined.includes('Purchase price must be between 0 and 100 000 000 som')) {
    return {
      message: 'Закупочная цена должна быть от 0 до 100 000 000 сом.',
      field: 'itemsGeneral',
    };
  }
  if (
    combined.includes('Line total exceeds maximum safe number bounds') ||
    combined.includes('Receipt total exceeds maximum safe number bounds')
  ) {
    return {
      message: 'Общая сумма накладной превышает допустимый предел.',
      field: 'itemsGeneral',
    };
  }
  if (
    combined.includes('Resulting stock for product') &&
    combined.includes('exceeds maximum limit')
  ) {
    return {
      message: 'Суммарный остаток товара на складе превысит максимальный предел 100 000 000 шт.',
      field: 'itemsGeneral',
    };
  }

  // 11. Unique violation (code 23505)
  if (code === '23505' || combined.includes('already exists') || combined.includes('уже существует')) {
    return {
      message: 'Накладная с таким номером или идентификатором уже зарегистрирована.',
    };
  }

  // General fallback
  return {
    message: 'Произошла ошибка при проведении накладной. Пожалуйста, повторите попытку.',
  };
};
