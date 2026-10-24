import type { AppRole, UserProfile } from '../../types';
import { Constants } from '../../types/database.types';
import { isValidUuid } from '../../utils/uuidUtils';

/** Raised when a rpc_get_my_profile response is malformed or belongs to another user. */
export class MyProfileDataError extends Error {
  constructor(message = 'Сервер вернул некорректные данные профиля. Повторите вход.') {
    super(message);
    this.name = 'MyProfileDataError';
  }
}

type JsonRecord = Record<string, unknown>;

/** Exact field set (migration 20261022200000_rbac_my_profile_rpc). Any other key rejects the response. */
const PROFILE_KEYS = ['id', 'full_name', 'role', 'is_active'];
const APP_ROLES: readonly string[] = Constants.public.Enums.app_role;

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const readExact = (value: unknown, keys: readonly string[]): JsonRecord => {
  if (!isRecord(value)) throw new MyProfileDataError();
  const own = Object.keys(value);
  if (own.length !== keys.length || !keys.every((k) => Object.prototype.hasOwnProperty.call(value, k))) {
    throw new MyProfileDataError();
  }
  return value;
};

const isAppRole = (value: unknown): value is AppRole =>
  typeof value === 'string' && APP_ROLES.includes(value);

/**
 * Parses rpc_get_my_profile: { profile: { id, full_name, role, is_active } | null }.
 * - null → no profile row for the signed-in user (treated as a not activated account);
 * - the profile must belong to the session user (`sessionUserId`), role must be admin / cashier,
 *   is_active must be a boolean (an inactive profile is returned as is).
 */
export const mapMyProfileResponse = (data: unknown, sessionUserId: string): UserProfile | null => {
  const root = readExact(data, ['profile']);
  if (root.profile === null) return null;

  const row = readExact(root.profile, PROFILE_KEYS);
  const { id, full_name: fullName, role, is_active: isActive } = row;
  // PostgreSQL emits canonical lowercase uuids
  if (!isValidUuid(id) || id !== id.toLowerCase() || id !== sessionUserId.toLowerCase()) {
    throw new MyProfileDataError();
  }
  if (typeof fullName !== 'string' || fullName.trim().length === 0) throw new MyProfileDataError();
  if (!isAppRole(role)) throw new MyProfileDataError();
  if (typeof isActive !== 'boolean') throw new MyProfileDataError();

  return { id, full_name: fullName, role, is_active: isActive };
};
