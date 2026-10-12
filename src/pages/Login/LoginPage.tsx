import { useState, useRef, useEffect, type FormEvent } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Eye, EyeOff, AlertCircle, Loader2 } from 'lucide-react';
import { useAuth } from '../../context';
import styles from './LoginPage.module.scss';

const getSafeRedirectPath = (fromState: unknown): string => {
  if (
    fromState &&
    typeof fromState === 'object' &&
    'pathname' in fromState &&
    typeof (fromState as { pathname: unknown }).pathname === 'string'
  ) {
    const path = (fromState as { pathname: string }).pathname;
    // Allow only internal relative routes, disallow protocol-relative URLs or external redirects
    if (path.startsWith('/') && !path.startsWith('//') && !path.includes(':')) {
      const search =
        'search' in fromState && typeof (fromState as { search: unknown }).search === 'string'
          ? (fromState as { search: string }).search
          : '';
      return `${path}${search}`;
    }
  }
  return '/';
};

export const LoginPage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { status, signIn, errorMessage: contextError } = useAuth();

  const navState = location.state as { authMessage?: string; from?: unknown } | null;
  const redirectedMessage = navState?.authMessage;

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});

  const displayedGeneralError =
    formError ||
    (status === 'inactive' || status === 'error' ? contextError : null) ||
    redirectedMessage ||
    null;

  const emailInputRef = useRef<HTMLInputElement>(null);
  const passwordInputRef = useRef<HTMLInputElement>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // If already authenticated, redirect to destination
  useEffect(() => {
    if (status === 'authenticated') {
      const destination = getSafeRedirectPath(
        (location.state as { from?: unknown } | null)?.from
      );
      navigate(destination, { replace: true });
    }
  }, [status, navigate, location.state]);

  const validate = (): boolean => {
    const nextErrors: { email?: string; password?: string } = {};

    const cleanEmail = email.trim();
    if (!cleanEmail) {
      nextErrors.email = 'Введите адрес электронной почты';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      nextErrors.email = 'Введите корректный адрес электронной почты';
    }

    if (!password) {
      nextErrors.password = 'Введите пароль';
    } else if (password.length < 6) {
      nextErrors.password = 'Пароль должен содержать не менее 6 символов';
    }

    setFieldErrors(nextErrors);

    if (nextErrors.email) {
      emailInputRef.current?.focus();
      return false;
    }
    if (nextErrors.password) {
      passwordInputRef.current?.focus();
      return false;
    }

    return true;
  };

  const isFormDisabled = isSubmitting || status === 'loading';

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (isFormDisabled) return;

    if (!validate()) {
      return;
    }

    setIsSubmitting(true);
    setFormError(null);

    const result = await signIn(email, password);

    if (!isMountedRef.current) return;
    setIsSubmitting(false);

    if (!result.success) {
      setFormError(result.error || 'Не удалось войти в систему. Проверьте данные.');
      requestAnimationFrame(() => {
        if (!isMountedRef.current) return;
        passwordInputRef.current?.focus();
        passwordInputRef.current?.select();
      });
    } else {
      const destination = getSafeRedirectPath(
        (location.state as { from?: unknown } | null)?.from
      );
      navigate(destination, { replace: true });
    }
  };

  return (
    <div className={styles.loginContainer}>
      <div className={styles.card}>
        {/* Brand Header */}
        <div className={styles.brandHeader}>
          <div className={styles.logoBadge} aria-hidden="true">
            <span className={styles.logoLetter}>S</span>
          </div>
          <h1 className={styles.brandTitle}>Smart Store</h1>
          <p className={styles.brandSubtitle}>Система учёта</p>
        </div>

        {/* Global Error Banner */}
        {displayedGeneralError && (
          <div
            id="login-general-error"
            className={styles.alertError}
            role="alert"
            aria-live="assertive"
          >
            <AlertCircle size={18} className={styles.alertIcon} aria-hidden="true" />
            <span className={styles.alertText}>{displayedGeneralError}</span>
          </div>
        )}

        {/* Login Form */}
        <form className={styles.form} onSubmit={handleSubmit} noValidate>
          <div className={styles.formGroup}>
            <label htmlFor="login-email" className={styles.label}>
              Email <span className={styles.requiredStar}>*</span>
            </label>
            <input
              ref={emailInputRef}
              id="login-email"
              type="email"
              name="email"
              className={styles.input}
              placeholder="admin@smartstore.kg"
              autoComplete="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (fieldErrors.email) {
                  setFieldErrors((prev) => ({ ...prev, email: undefined }));
                }
              }}
              disabled={isFormDisabled}
              aria-invalid={fieldErrors.email ? 'true' : undefined}
              aria-describedby={fieldErrors.email ? 'login-email-error' : undefined}
            />
            {fieldErrors.email && (
              <span id="login-email-error" className={styles.fieldError} role="alert">
                {fieldErrors.email}
              </span>
            )}
          </div>

          <div className={styles.formGroup}>
            <label htmlFor="login-password" className={styles.label}>
              Пароль <span className={styles.requiredStar}>*</span>
            </label>
            <div className={styles.passwordWrapper}>
              <input
                ref={passwordInputRef}
                id="login-password"
                type={showPassword ? 'text' : 'password'}
                name="password"
                className={styles.input}
                placeholder="••••••••"
                autoComplete="current-password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (fieldErrors.password) {
                    setFieldErrors((prev) => ({ ...prev, password: undefined }));
                  }
                }}
                disabled={isFormDisabled}
                aria-invalid={fieldErrors.password ? 'true' : undefined}
                aria-describedby={fieldErrors.password ? 'login-password-error' : undefined}
              />
              <button
                type="button"
                className={styles.passwordToggle}
                onClick={() => setShowPassword((prev) => !prev)}
                aria-label={showPassword ? 'Скрыть пароль' : 'Показать пароль'}
                aria-pressed={showPassword}
                disabled={isFormDisabled}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
            {fieldErrors.password && (
              <span id="login-password-error" className={styles.fieldError} role="alert">
                {fieldErrors.password}
              </span>
            )}
          </div>

          <button
            type="submit"
            className={styles.submitButton}
            disabled={isFormDisabled}
            aria-busy={isSubmitting || status === 'loading'}
          >
            {isSubmitting || status === 'loading' ? (
              <>
                <Loader2 size={18} className={styles.buttonSpinner} aria-hidden="true" />
                <span>{status === 'loading' ? 'Проверка сессии...' : 'Вход в систему...'}</span>
              </>
            ) : (
              <span>Войти</span>
            )}
          </button>
        </form>
      </div>
    </div>
  );
};
