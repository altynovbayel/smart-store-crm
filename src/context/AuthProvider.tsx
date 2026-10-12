import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  type ReactNode,
} from 'react';
import type { User, Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { AuthContext } from './AuthContext';
import type {
  AuthStatus,
  UserProfile,
  AuthContextValue,
} from '../types/auth';

export interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider = ({ children }: AuthProviderProps) => {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const isMountedRef = useRef(true);
  const requestIdRef = useRef(0);
  const isSigningInRef = useRef(false);
  const isSigningOutRef = useRef(false);
  const isInactiveAccountRef = useRef(false);
  const inactiveMessageRef = useRef<string | null>(null);
  const signOutPromiseRef = useRef<Promise<{ success: boolean; error?: string }> | null>(null);
  const currentUserRef = useRef<User | null>(null);



  const loadProfile = async (
    currentSession: Session | null
  ): Promise<{
    status: AuthStatus;
    user: User | null;
    session: Session | null;
    profile: UserProfile | null;
    error: string | null;
  }> => {
    if (!currentSession?.user) {
      return {
        status: 'unauthenticated',
        user: null,
        session: null,
        profile: null,
        error: null,
      };
    }

    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', currentSession.user.id)
        .maybeSingle();

      if (error) {
        return {
          status: 'error',
          user: currentSession.user,
          session: currentSession,
          profile: null,
          error: 'Не удалось загрузить данные профиля. Проверьте соединение с интернетом.',
        };
      }

      if (!data || !data.is_active || (data.role !== 'admin' && data.role !== 'cashier')) {
        return {
          status: 'inactive',
          user: null,
          session: null,
          profile: null,
          error: 'Учётная запись не активирована. Обратитесь к администратору.',
        };
      }

      return {
        status: 'authenticated',
        user: currentSession.user,
        session: currentSession,
        profile: data,
        error: null,
      };
    } catch {
      return {
        status: 'error',
        user: currentSession.user,
        session: currentSession,
        profile: null,
        error: 'Произошла непредвиденная ошибка при проверке учётной записи.',
      };
    }
  };

  const performSignOut = useCallback(async (isInactive = false, inactiveMsg: string | null = null): Promise<{ success: boolean; error?: string }> => {
    requestIdRef.current++;
    isSigningOutRef.current = true;
    if (isInactive) {
      isInactiveAccountRef.current = true;
      inactiveMessageRef.current = inactiveMsg;
      if (isMountedRef.current) {
        setStatus('inactive');
        setUser(null);
        setSession(null);
        setProfile(null);
        setErrorMessage(inactiveMsg);
      }
    } else {
      isInactiveAccountRef.current = false;
      inactiveMessageRef.current = null;
      if (isMountedRef.current) {
        setStatus('unauthenticated');
        setUser(null);
        setSession(null);
        setProfile(null);
        setErrorMessage(null);
      }
    }

    const promise = (async (): Promise<{ success: boolean; error?: string }> => {
      try {
        const { error } = await supabase.auth.signOut();
        if (error) {
          return {
            success: false,
            error: 'Не удалось завершить сессию на сервере. Локальный доступ закрыт.',
          };
        }
        return { success: true };
      } catch {
        return {
          success: false,
          error: 'Ошибка сети при выходе из системы. Локальный доступ закрыт.',
        };
      } finally {
        isSigningOutRef.current = false;
      }
    })();

    signOutPromiseRef.current = promise;
    try {
      return await promise;
    } finally {
      if (signOutPromiseRef.current === promise) {
        signOutPromiseRef.current = null;
      }
    }
  }, []);

  const applySession = useCallback(
    async (
      currentSession: Session | null,
      isBackground = false,
      expectedReqId?: number
    ) => {
      if (isSigningOutRef.current) {
        return;
      }
      const currentReqId = expectedReqId ?? ++requestIdRef.current;
      if (!isBackground && isMountedRef.current) {
        setStatus('loading');
      }

      const result = await loadProfile(currentSession);

      if (
        !isMountedRef.current ||
        currentReqId !== requestIdRef.current ||
        isSigningOutRef.current
      ) {
        return;
      }

      if (result.status === 'inactive') {
        const reason = result.error || 'Учётная запись не активирована. Обратитесь к администратору.';
        performSignOut(true, reason);
        return;
      } else if (result.status === 'authenticated') {
        isInactiveAccountRef.current = false;
        inactiveMessageRef.current = null;
      }

      // If this is a background refresh and current status is already authenticated,
      // a temporary network error fetching profile should not destroy user work and unmount forms.
      if (isBackground && result.status === 'error' && currentUserRef.current?.id === currentSession?.user?.id) {
        setErrorMessage(result.error);
        return;
      }

      setStatus(result.status);
      setUser(result.user);
      setSession(result.session);
      setProfile(result.profile);
      setErrorMessage(result.error);
    },
    [performSignOut]
  );

  useEffect(() => {
    currentUserRef.current = user;
    if (!user) return;

    // Realtime subscription on public.profiles to immediately reflect role updates and account deactivation
    const channel = supabase
      .channel(`profile-updates-${user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'profiles',
          filter: `id=eq.${user.id}`,
        },
        () => {
          supabase.auth.getSession().then(({ data: { session: s } }) => {
            if (!isMountedRef.current || isSigningInRef.current || isSigningOutRef.current) return;
            if (s?.user?.id === user.id) {
              applySession(s, true);
            }
          }).catch(() => {});
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, applySession]);

  useEffect(() => {
    isMountedRef.current = true;

    // 1. Get initial session
    const initReqId = ++requestIdRef.current;
    supabase.auth
      .getSession()
      .then(({ data: { session: initialSession }, error }) => {
        if (
          !isMountedRef.current ||
          initReqId !== requestIdRef.current ||
          isSigningInRef.current ||
          isSigningOutRef.current
        ) {
          return;
        }
        if (error) {
          setStatus('error');
          setErrorMessage('Ошибка инициализации сессии. Проверьте подключение к сети.');
          return;
        }
        applySession(initialSession, false, initReqId);
      })
      .catch(() => {
        if (
          !isMountedRef.current ||
          initReqId !== requestIdRef.current ||
          isSigningInRef.current ||
          isSigningOutRef.current
        ) {
          return;
        }
        setStatus('error');
        setErrorMessage('Ошибка инициализации сессии.');
      });

    // 2. Subscribe to auth state changes without blocking listener callback
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, newSession) => {
      // If a direct signIn call is currently in progress, do not intercept or cancel it
      if ((event === 'SIGNED_IN' || event === 'INITIAL_SESSION') && isSigningInRef.current) {
        return;
      }

      // If signing out is in progress, ignore any delayed auth events
      if (isSigningOutRef.current && event !== 'SIGNED_OUT') {
        return;
      }

      // Allocate event request ID synchronously at trigger time
      const eventReqId = ++requestIdRef.current;

      setTimeout(() => {
        if (!isMountedRef.current) return;

        // If this event has already been superseded by a newer auth action, ignore it
        if (eventReqId !== requestIdRef.current) {
          return;
        }

        if (event === 'SIGNED_OUT') {
          // If sign out was triggered because profile is inactive, retain inactive status and error message
          if (isInactiveAccountRef.current) {
            setStatus('inactive');
            setUser(null);
            setSession(null);
            setProfile(null);
            setErrorMessage(inactiveMessageRef.current);
            return;
          }

          setStatus('unauthenticated');
          setUser(null);
          setSession(null);
          setProfile(null);
          setErrorMessage(null);
          return;
        }

        // If signing out is in progress, ignore any delayed auth events (such as TOKEN_REFRESHED)
        if (isSigningOutRef.current) {
          return;
        }

        // Token refresh, repeated sign-in or user profile update for the same user is updated smoothly in the background
        const isSameUser =
          currentUserRef.current !== null &&
          newSession?.user?.id === currentUserRef.current.id;
        const isBackground =
          event === 'TOKEN_REFRESHED' ||
          ((event === 'SIGNED_IN' || event === 'USER_UPDATED') && isSameUser);

        // If this SIGNED_IN event belongs to the current user, applySession runs with background mode
        applySession(newSession, isBackground, eventReqId);
      }, 0);
    });

    // 3. Proactively refresh profile on window focus or visibility change
    const handleWindowFocus = () => {
      if (document.visibilityState === 'visible' && currentUserRef.current) {
        supabase.auth.getSession().then(({ data: { session: s } }) => {
          if (!isMountedRef.current || isSigningInRef.current || isSigningOutRef.current) return;
          if (s?.user?.id === currentUserRef.current?.id) {
            applySession(s, true);
          }
        }).catch(() => {});
      }
    };

    window.addEventListener('focus', handleWindowFocus);
    document.addEventListener('visibilitychange', handleWindowFocus);

    return () => {
      isMountedRef.current = false;
      subscription.unsubscribe();
      window.removeEventListener('focus', handleWindowFocus);
      document.removeEventListener('visibilitychange', handleWindowFocus);
    };
  }, [applySession]);

  const signIn = useCallback(
    async (email: string, password: string): Promise<{ success: boolean; error?: string }> => {
      // If a signOut operation is currently in flight, wait for it to finish before starting a new signIn
      if (signOutPromiseRef.current) {
        try {
          await signOutPromiseRef.current;
        } catch {
          // ignore
        }
      }

      const currentReqId = ++requestIdRef.current;
      isSigningInRef.current = true;
      setStatus('loading');
      try {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });

        if (!isMountedRef.current || currentReqId !== requestIdRef.current) {
          return { success: false, error: 'Запрос был отменён.' };
        }

        if (error) {
          let safeMessage = 'Не удалось войти в систему. Проверьте данные и повторите попытку.';
          const raw = error.message.toLowerCase();
          if (raw.includes('invalid login credentials') || raw.includes('invalid_grant')) {
            safeMessage = 'Неверный email или пароль';
          } else if (raw.includes('email not confirmed')) {
            safeMessage = 'Электронная почта не подтверждена';
          } else if (raw.includes('too many requests') || raw.includes('rate limit')) {
            safeMessage = 'Слишком много попыток входа. Пожалуйста, подождите.';
          } else if (raw.includes('network') || raw.includes('fetch')) {
            safeMessage = 'Ошибка сети. Проверьте подключение к интернету.';
          }
          setStatus('unauthenticated');
          setErrorMessage(safeMessage);
          return { success: false, error: safeMessage };
        }

        if (!data.session) {
          setStatus('unauthenticated');
          setErrorMessage('Сессия не была создана. Попробуйте снова.');
          return { success: false, error: 'Сессия не была создана. Попробуйте снова.' };
        }

        const result = await loadProfile(data.session);

        if (!isMountedRef.current || currentReqId !== requestIdRef.current) {
          return { success: false, error: 'Запрос был отменён.' };
        }

        if (result.status === 'inactive') {
          const reason = result.error || 'Учётная запись не активирована. Обратитесь к администратору.';
          performSignOut(true, reason);
          return {
            success: false,
            error: reason,
          };
        } else if (result.status === 'authenticated') {
          isInactiveAccountRef.current = false;
          inactiveMessageRef.current = null;
        }

        setStatus(result.status);
        setUser(result.user);
        setSession(result.session);
        setProfile(result.profile);
        setErrorMessage(result.error);

        if (result.status === 'error') {
          return {
            success: false,
            error: result.error || 'Ошибка загрузки профиля',
          };
        }

        return { success: true };
      } catch {
        if (!isMountedRef.current || currentReqId !== requestIdRef.current) {
          return { success: false, error: 'Запрос был отменён.' };
        }
        setStatus('error');
        setErrorMessage('Произошла непредвиденная ошибка при входе. Проверьте подключение к интернету.');
        return {
          success: false,
          error: 'Произошла непредвиденная ошибка при входе. Проверьте подключение к интернету.',
        };
      } finally {
        isSigningInRef.current = false;
      }
    },
    [performSignOut]
  );

  const signOut = useCallback(async (): Promise<{ success: boolean; error?: string }> => {
    return performSignOut(false, null);
  }, [performSignOut]);

  const refreshProfile = useCallback(async () => {
    const refreshReqId = ++requestIdRef.current;
    try {
      const {
        data: { session: currentSession },
      } = await supabase.auth.getSession();

      if (
        !isMountedRef.current ||
        refreshReqId !== requestIdRef.current ||
        isSigningInRef.current ||
        isSigningOutRef.current
      ) {
        return;
      }

      await applySession(currentSession, true, refreshReqId);
    } catch {
      if (
        !isMountedRef.current ||
        refreshReqId !== requestIdRef.current ||
        isSigningInRef.current ||
        isSigningOutRef.current
      ) {
        return;
      }

      setStatus('error');
      setErrorMessage('Не удалось обновить профиль. Проверьте сеть.');
    }
  }, [applySession]);

  const isAdmin =
    status === 'authenticated' && profile?.role === 'admin' && profile?.is_active === true;
  const isCashier =
    status === 'authenticated' && profile?.role === 'cashier' && profile?.is_active === true;

  const value: AuthContextValue = useMemo(
    () => ({
      status,
      user,
      session,
      profile,
      isAdmin,
      isCashier,
      errorMessage,
      signIn,
      signOut,
      refreshProfile,
    }),
    [status, user, session, profile, isAdmin, isCashier, errorMessage, signIn, signOut, refreshProfile]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
