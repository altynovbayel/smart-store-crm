import type { User, Session } from '@supabase/supabase-js';
import type { Database } from './database.types';

/** Own profile as returned by rpc_get_my_profile (exactly these four fields). */
export type UserProfile = Pick<
  Database['public']['Tables']['profiles']['Row'],
  'id' | 'full_name' | 'role' | 'is_active'
>;
export type AppRole = Database['public']['Enums']['app_role'];

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated' | 'inactive' | 'error';

export interface AuthContextValue {
  status: AuthStatus;
  user: User | null;
  session: Session | null;
  profile: UserProfile | null;
  isAdmin: boolean;
  isCashier: boolean;
  errorMessage: string | null;
  signIn: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  signOut: () => Promise<{ success: boolean; error?: string }>;
  refreshProfile: () => Promise<void>;
}
