import type { MappedApiError } from '../../types';
import {
  GATEWAY_STATUSES,
  classifySupabaseError,
  isSessionAuthFailure,
  readErrorSignals,
} from '../shared/supabaseErrorClassifier';

/** Raised by the mappers when an RPC response is malformed, inconsistent or exceeds safe integers. */
export class ReportsDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReportsDataError';
  }
}

/**
 * Maps Reports RPC / mapping errors to safe Russian messages. All reports are read-only,
 * so every kind can simply be retried by the user.
 */
export const mapReportsError = (error: unknown): MappedApiError => {
  if (error instanceof ReportsDataError) {
    return { kind: 'internal', message: error.message };
  }

  switch (classifySupabaseError(error)) {
    case 'auth':
      return {
        kind: 'auth',
        message: isSessionAuthFailure(error)
          ? 'Сессия истекла или требуется повторная авторизация. Пожалуйста, выполните вход заново.'
          : 'Недостаточно прав: отчёты доступны только активному администратору.',
      };
    case 'network': {
      const status = readErrorSignals(error)?.status;
      return {
        kind: 'network',
        message:
          status !== undefined && GATEWAY_STATUSES.has(status)
            ? 'Сервер временно недоступен. Повторите попытку позже.'
            : 'Ошибка сети при загрузке отчёта. Проверьте подключение к интернету.',
      };
    }
    case 'domain':
      return { kind: 'domain', message: 'Сервер отклонил запрос отчёта. Проверьте выбранный период.' };
    default:
      return { kind: 'internal', message: 'Не удалось загрузить отчёт. Повторите попытку.' };
  }
};
