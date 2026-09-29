import { createBrowserRouter, Navigate } from 'react-router-dom';
import { MainLayout } from '../components/layout/MainLayout/MainLayout';
import { DashboardPage } from '../pages/Dashboard/DashboardPage';
import { SalesPage } from '../pages/Sales/SalesPage';
import { IncomePage } from '../pages/Income/IncomePage';
import { OutcomePage } from '../pages/Outcome/OutcomePage';
import { WarehousePage } from '../pages/Warehouse/WarehousePage';
import { SalesHistoryPage } from '../pages/SalesHistory/SalesHistoryPage';
import { ReportsPage } from '../pages/Reports/ReportsPage';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <MainLayout />,
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
        element: <IncomePage />,
      },
      {
        path: 'outcome',
        element: <OutcomePage />,
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
        element: <ReportsPage />,
      },
      {
        path: '*',
        element: <Navigate to="/" replace />,
      },
    ],
  },
]);
