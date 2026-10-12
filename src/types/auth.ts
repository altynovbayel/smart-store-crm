import type { User, Session } from '@supabase/supabase-js';
import type { Database } from './database.types';

export type UserProfile = Database['public']['Tables']['profiles']['Row'];
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
