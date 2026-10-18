import { useState, useEffect, useMemo } from 'react';
import { AlertCircle, RotateCcw } from 'lucide-react';
import { StatCard } from '../../components/dashboard/StatCard/StatCard';
import { RevenueChart } from '../../components/dashboard/RevenueChart/RevenueChart';
import { PopularProducts } from '../../components/dashboard/PopularProducts/PopularProducts';
import { RecentSales } from '../../components/dashboard/RecentSales/RecentSales';
import { LowStock } from '../../components/dashboard/LowStock/LowStock';
import { useAuth } from '../../context';
import type { DashboardMetric } from '../../types';
import { formatCalendarDateKey } from '../../utils/dateUtils';
import {
  buildLowStockItems,
  buildPopularProductItems,
  buildRecentSaleRows,
  buildRevenueChartPoints,
  buildSalesMetricCards,
  buildStockMetricCards,
} from '../../utils/dashboardCalculations';
import { useDashboardData } from './hooks/useDashboardData';
import styles from './DashboardPage.module.scss';

type SourceView = 'loading' | 'error' | 'ready';

const toSourceView = (source: { data: unknown; isLoading: boolean; error: string | null }): SourceView => {
  if (source.data) return 'ready';
  return source.error && !source.isLoading ? 'error' : 'loading';
};

interface BlockPlaceholderProps {
  view: Exclude<SourceView, 'ready'>;
  label: string;
}

/** Loading / unavailable placeholder of one Dashboard block (keeps the grid layout). */
const BlockPlaceholder = ({ view, label }: BlockPlaceholderProps) => (
  <div className={`${styles.tableLoadingCard} ${styles.blockPlaceholder}`}>
    {view === 'loading' ? (
      <>
        <div className={styles.spinner} role="progressbar" aria-label={`Загрузка: ${label}`} />
        <span className={styles.loadingText}>Загрузка: {label}...</span>
      </>
    ) : (
      <span className={styles.loadingText}>{label}: данные недоступны</span>
    )}
  </div>
);

/**
 * Dashboard works only with the read-only aggregation RPCs (no InventoryContext, no mock data,
 * no cost / purchase price / profit). Sales and stock are independent sources: an error in one
 * never hides the other.
 */
export const DashboardPage = () => {
  const { user } = useAuth();
  const userId = user?.id ?? null;

  // Keep track of current calendar date (YYYY-MM-DD)
  const [currentDateKey, setCurrentDateKey] = useState(() => formatCalendarDateKey(new Date()));

  useEffect(() => {
    const updateDate = () => {
      const newKey = formatCalendarDateKey(new Date());
      setCurrentDateKey((prev) => (prev !== newKey ? newKey : prev));
    };

    const handleFocus = () => updateDate();
    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleFocus);
    const interval = setInterval(updateDate, 30_000);

    return () => {
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleFocus);
      clearInterval(interval);
    };
  }, []);

  const { sales, stock, retrySales, retryStock } = useDashboardData({ userId, currentDateKey });
  const salesView = toSourceView(sales);
  const stockView = toSourceView(stock);
  const dailySales = sales.data?.dailySales ?? null;

  const metrics = useMemo<DashboardMetric[]>(
    () => [
      ...buildSalesMetricCards(dailySales, salesView),
      ...buildStockMetricCards(stock.data?.totals ?? null, stockView),
    ],
    [dailySales, salesView, stock.data, stockView]
  );

  // 7 / 14 / 30 points come from one 30-day series: switching the chart period never refetches
  const revenue7Days = useMemo(
    () => (dailySales ? buildRevenueChartPoints(dailySales, 7, currentDateKey) : []),
    [dailySales, currentDateKey]
  );
  const revenue14Days = useMemo(
    () => (dailySales ? buildRevenueChartPoints(dailySales, 14, currentDateKey) : []),
    [dailySales, currentDateKey]
  );
  const revenue30Days = useMemo(
    () => (dailySales ? buildRevenueChartPoints(dailySales, 30, currentDateKey) : []),
    [dailySales, currentDateKey]
  );

  const popularProducts = useMemo(
    () => buildPopularProductItems(sales.data?.popularProducts ?? []),
    [sales.data]
  );
  const recentSales = useMemo(
    () => buildRecentSaleRows(sales.data?.recentSales ?? []),
    [sales.data]
  );
  const lowStockItems = useMemo(
    () => buildLowStockItems(stock.data?.lowStockProducts ?? []),
    [stock.data]
  );

  return (
    <div className={styles.dashboard}>
      {/* Source errors with independent retry */}
      {(sales.error || stock.error) && (
        <div className={styles.statusBanners}>
          {sales.error && (
            <div className={styles.errorBanner} role="alert">
              <div className={styles.errorInfo}>
                <AlertCircle size={20} />
                <span className={styles.errorText}>Продажи: {sales.error}</span>
              </div>
              <button
                type="button"
                data-retry-dashboard-sales-btn
                className={styles.retryBtn}
                onClick={retrySales}
                disabled={sales.isLoading}
              >
                <RotateCcw size={14} />
                <span>{sales.isLoading ? 'Загрузка...' : 'Повторить'}</span>
              </button>
            </div>
          )}
          {stock.error && (
            <div className={styles.errorBanner} role="alert">
              <div className={styles.errorInfo}>
                <AlertCircle size={20} />
                <span className={styles.errorText}>Склад: {stock.error}</span>
              </div>
              <button
                type="button"
                data-retry-dashboard-stock-btn
                className={styles.retryBtn}
                onClick={retryStock}
                disabled={stock.isLoading}
              >
                <RotateCcw size={14} />
                <span>{stock.isLoading ? 'Загрузка...' : 'Повторить'}</span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* 4 Metric Cards */}
      <section className={styles.metricsGrid} aria-label="Ключевые показатели">
        {metrics.map((metric) => (
          <StatCard key={metric.id} metric={metric} />
        ))}
      </section>

      {/* Middle Grid: Revenue Chart + Popular Products */}
      <section
        className={styles.twoColumnGrid}
        aria-label="Выручка и популярные товары"
        aria-busy={salesView === 'loading'}
      >
        <div className={styles.chartCol}>
          {salesView === 'ready' ? (
            <RevenueChart data={revenue7Days} data14={revenue14Days} data30={revenue30Days} />
          ) : (
            <BlockPlaceholder view={salesView} label="Выручка" />
          )}
        </div>
        <div className={styles.sideCol}>
          {salesView === 'ready' ? (
            <PopularProducts products={popularProducts} periodLabel="за 30 дней" />
          ) : (
            <BlockPlaceholder view={salesView} label="Популярные товары" />
          )}
        </div>
      </section>

      {/* Bottom Grid: Recent Sales + Low Stock Items */}
      <section
        className={styles.twoColumnGrid}
        aria-label="Последние продажи и остатки"
        aria-busy={salesView === 'loading' || stockView === 'loading'}
      >
        <div className={styles.salesCol}>
          {salesView === 'ready' ? (
            <RecentSales sales={recentSales} />
          ) : (
            <BlockPlaceholder view={salesView} label="Последние продажи" />
          )}
        </div>
        <div className={styles.sideCol}>
          {stockView === 'ready' ? (
            <LowStock items={lowStockItems} />
          ) : (
            <BlockPlaceholder view={stockView} label="Остатки" />
          )}
        </div>
      </section>
    </div>
  );
};
