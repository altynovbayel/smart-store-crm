import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../../../context';
import type { AppRole } from '../../../types';
import { PageLoader } from '../PageLoader/PageLoader';

export interface ProtectedRouteProps {
  children?: React.ReactNode;
  allowedRoles?: AppRole[];
}

export const ProtectedRoute = ({ children, allowedRoles }: ProtectedRouteProps) => {
  const { status, profile, errorMessage } = useAuth();
  const location = useLocation();

  if (status === 'loading') {
    return <PageLoader message="Проверка авторизации..." />;
  }

  if (status !== 'authenticated') {
    return (
      <Navigate
        to="/login"
        replace
        state={{
          from: location,
          authMessage:
            status === 'inactive' || status === 'error'
              ? errorMessage
              : undefined,
        }}
      />
    );
  }

  if (allowedRoles && profile && !allowedRoles.includes(profile.role)) {
    return <Navigate to="/" replace />;
  }

  return children ? <>{children}</> : <Outlet />;
};
