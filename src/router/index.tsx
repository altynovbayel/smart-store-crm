import { createBrowserRouter, Navigate } from 'react-router-dom';
import { MainLayout } from '../components/layout/MainLayout/MainLayout';
import { ProtectedRoute } from '../components/common/ProtectedRoute/ProtectedRoute';
import { LoginPage } from '../pages/Login/LoginPage';
import { DashboardPage } from '../pages/Dashboard/DashboardPage';
import { SalesPage } from '../pages/Sales/SalesPage';
import { IncomePage } from '../pages/Income/IncomePage';
import { OutcomePage } from '../pages/Outcome/OutcomePage';
import { WarehousePage } from '../pages/Warehouse/WarehousePage';
import { SalesHistoryPage } from '../pages/SalesHistory/SalesHistoryPage';
import { ReportsPage } from '../pages/Reports/ReportsPage';

export const router = createBrowserRouter([
  {
    path: '/login',
    element: <LoginPage />,
  },
  {
    path: '/',
    element: (
      <ProtectedRoute>
        <MainLayout />
      </ProtectedRoute>
    ),
    children: [
      {
        index: true,
        element: <DashboardPage />,
      },
      {
        path: 'sales',
        element: <SalesPage />,
      },
      {
        path: 'income',
        element: (
          <ProtectedRoute allowedRoles={['admin']}>
            <IncomePage />
          </ProtectedRoute>
        ),
      },
      {
        path: 'outcome',
        element: (
          <ProtectedRoute allowedRoles={['admin']}>
            <OutcomePage />
          </ProtectedRoute>
        ),
      },
      {
        path: 'warehouse',
        element: <WarehousePage />,
      },
      {
        path: 'sales-history',
        element: <SalesHistoryPage />,
      },
      {
        path: 'reports',
        element: (
          <ProtectedRoute allowedRoles={['admin']}>
            <ReportsPage />
          </ProtectedRoute>
        ),
      },
      {
        path: '*',
        element: <Navigate to="/" replace />,
      },
    ],
  },
  {
    path: '*',
    element: <Navigate to="/" replace />,
  },
]);
