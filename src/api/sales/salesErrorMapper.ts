import type { MappedSaleError, ApiErrorKind } from '../../types';
import { SaleValidationError } from './salesValidationError';
import {
  GATEWAY_STATUSES,
  classifySupabaseError,
  isIndeterminateErrorKind,
  isSessionAuthFailure,
  readErrorMessage,
  readErrorSignals,
} from '../shared/supabaseErrorClassifier';

/** SQLSTATE raised by private.enforce_sale_item_catalog_price (migration 20261018120000). */
export const SALE_PRICE_CHANGED_SQLSTATE = 'SSP01';

/**
 * Classifies any error of a sale operation.
 * Only `validation` and `domain` are deterministic: the sale definitely did not commit.
 */
export const classifySaleError = (error: unknown): ApiErrorKind => {
  if (error instanceof SaleValidationError) return 'validation';
  return classifySupabaseError(error);
};

/** True when the server outcome is unknown and the pending sale UUID must be preserved. */
export const isIndeterminateSaleError = (error: MappedSaleError): boolean =>
  isIndeterminateErrorKind(error.kind);

/** Structural check (SQLSTATE) for a refused sale because the catalog price changed. */
export const isSalePriceChangedError = (error: unknown): boolean =>
  readErrorSignals(error)?.code === SALE_PRICE_CHANGED_SQLSTATE;

const formatMinor = (raw: string): string => {
  const minor = Number(raw);
  if (!Number.isSafeInteger(minor)) return raw;
  return `${(minor / 100).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} сом`;
};

const mapNetworkError = (error: unknown): MappedSaleError => {
  const status = readErrorSignals(error)?.status;
  if (status !== undefined && GATEWAY_STATUSES.has(status)) {
    return {
      kind: 'network',
      message:
        'Ошибка связи с сервером (шлюз недоступен). Результат продажи не подтверждён — проверьте статус после восстановления связи.',
    };
  }
  if (status !== undefined && status >= 500) {
    return {
      kind: 'network',
      message: 'Внутренняя ошибка сервера. Результат продажи не подтверждён — проверьте статус чека.',
    };
  }
  return {
    kind: 'network',
    message: 'Ошибка сети или связи с сервером. Проверьте подключение к интернету и повторите попытку.',
  };
};

const mapAuthError = (error: unknown): MappedSaleError =>
  isSessionAuthFailure(error)
    ? {
        kind: 'auth',
        message: 'Сессия истекла или требуется повторная авторизация. Пожалуйста, выполните вход заново.',
      }
    : {
        kind: 'auth',
        message: 'Недостаточно прав для проведения продажи. Учётная запись неактивна или доступ ограничен.',
      };

/**
 * Maps a deterministic server refusal to a user-facing message.
 * Message text is used only to pick a friendly description — classification is already done.
 */
const mapDomainError = (error: unknown): MappedSaleError => {
  const message = readErrorMessage(error);
  const code = readErrorSignals(error)?.code ?? '';

  if (code === SALE_PRICE_CHANGED_SQLSTATE) {
    const match = message.match(/product "(.*)" changed \(expected: (\d+), current: (\d+)\)$/);
    const details = match
      ? ` товара «${match[1]}» (была ${formatMinor(match[2])}, сейчас ${formatMinor(match[3])})`
      : '';
    return {
      kind: 'domain',
      message: `Цена продажи${details} изменилась. Каталог обновлён — проверьте новый итог и проведите продажу ещё раз.`,
      field: 'itemsGeneral',
    };
  }

  if (message.startsWith('Insufficient stock for product')) {
    const match = message.match(/^Insufficient stock for product "(.*)" \(available: (\d+), requested: (\d+)\)$/);
    return {
      kind: 'domain',
      message: match
        ? `Недостаточный остаток товара «${match[1]}» (доступно: ${match[2]} шт., запрошено: ${match[3]} шт.). Каталог обновлён — проверьте количество.`
        : 'Недостаточный остаток товара на складе. Каталог обновлён — проверьте количество.',
      field: 'itemsGeneral',
    };
  }

  if (message.startsWith('Validation error: Cannot sell archived product')) {
    return {
      kind: 'domain',
      message: 'Товар из чека архивирован и недоступен для продажи. Каталог обновлён — удалите позицию.',
      field: 'itemsGeneral',
    };
  }

  if (code === 'P0002' || code === 'PGRST116') {
    return {
      kind: 'domain',
      message: 'Выбранные товары не найдены в каталоге. Каталог обновлён — проверьте позиции чека.',
      field: 'itemsGeneral',
    };
  }

  if (message.startsWith('Validation error: Sale date cannot be in the future')) {
    return { kind: 'domain', message: 'Дата продажи не может быть в будущем.', field: 'soldAt' };
  }

  if (message.startsWith('Validation error: Sale at') && message.includes('negative')) {
    return {
      kind: 'domain',
      message:
        'Невозможно провести продажу указанной датой: это приведёт к отрицательному остатку товара в этот день или в последующих операциях.',
      field: 'soldAt',
    };
  }

  if (message.startsWith('Validation error: Sale must contain at least one line item')) {
    return { kind: 'domain', message: 'Добавьте хотя бы один товар в чек.', field: 'itemsGeneral' };
  }

  if (message.startsWith('Validation error: Duplicate product in sale items')) {
    return {
      kind: 'domain',
      message: 'В чеке содержатся повторяющиеся товары. Объедините позиции.',
      field: 'itemsGeneral',
    };
  }

  if (message.startsWith('Validation error: Payment method is required')) {
    return { kind: 'domain', message: 'Выберите способ оплаты.', field: 'paymentMethod' };
  }

  if (message.startsWith('Validation error: Received cash amount')) {
    return {
      kind: 'domain',
      message: 'Полученная сумма наличных меньше итога к оплате или превышает допустимый предел.',
      field: 'receivedAmount',
    };
  }

  if (message.startsWith('Validation error: Receipt')) {
    return {
      kind: 'domain',
      message: 'Скидка на чек должна быть меньше суммы товаров (процентная — меньше 100%).',
      field: 'receiptDiscount',
    };
  }

  if (message.startsWith('Validation error: Item')) {
    return {
      kind: 'domain',
      message: 'Скидка на позицию не может превышать сумму строки (процентная — не более 100%).',
      field: 'itemsGeneral',
    };
  }

  if (message.startsWith('Validation error: Quantity must be positive')) {
    return {
      kind: 'domain',
      message: 'Количество товара должно быть целым положительным числом не более 100 000 000 шт.',
      field: 'itemsGeneral',
    };
  }

  if (message.startsWith('Validation error: Unit selling price must be between')) {
    return {
      kind: 'domain',
      message: 'Цена продажи должна быть от 0 до 100 000 000 сом.',
      field: 'itemsGeneral',
    };
  }

  if (message.startsWith('Validation error: Sale total amount must be strictly greater than 0')) {
    return { kind: 'domain', message: 'Итоговая сумма продажи должна быть больше 0 сом.', field: 'totalAmount' };
  }

  if (
    message.startsWith('Validation error: Line monetary amounts exceed') ||
    message.startsWith('Validation error: Document total amounts exceed') ||
    message.startsWith('Validation error: Resulting profit or total exceeds') ||
    message.startsWith('Validation error: Line profit exceeds')
  ) {
    return {
      kind: 'domain',
      message: 'Сумма чека превышает допустимый математический предел.',
      field: 'totalAmount',
    };
  }

  if (code === '23505') {
    return { kind: 'domain', message: 'Чек с таким номером или идентификатором уже зарегистрирован.' };
  }

  return {
    kind: 'domain',
    message: 'Сервер отклонил продажу. Проверьте данные чека и повторите попытку.',
  };
};

/**
 * Maps client validation, PostgreSQL and Supabase errors to safe, user-facing Russian messages
 * without exposing internal SQL, database structure, constraints or stack traces.
 */
export const mapSaleError = (error: unknown): MappedSaleError => {
  if (error instanceof SaleValidationError) {
    return { kind: 'validation', message: error.message, field: error.field };
  }

  switch (classifySaleError(error)) {
    case 'auth':
      return mapAuthError(error);
    case 'network':
      return mapNetworkError(error);
    case 'domain':
      return mapDomainError(error);
    default:
      return {
        kind: 'internal',
        message: 'Произошла непредвиденная ошибка. Результат продажи не подтверждён — проверьте статус чека.',
      };
  }
};
