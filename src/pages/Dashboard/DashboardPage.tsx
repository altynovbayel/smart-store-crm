import { StatCard } from '../../components/dashboard/StatCard/StatCard';
import { RevenueChart } from '../../components/dashboard/RevenueChart/RevenueChart';
import { PopularProducts } from '../../components/dashboard/PopularProducts/PopularProducts';
import { RecentSales } from '../../components/dashboard/RecentSales/RecentSales';
import { LowStock } from '../../components/dashboard/LowStock/LowStock';
import {
  mockDashboardMetrics,
  mockWeeklyRevenue,
  mockPopularProducts,
  mockRecentSales,
  mockLowStockItems,
} from '../../data/mockData';
import styles from './DashboardPage.module.scss';

export const DashboardPage = () => {
  return (
    <div className={styles.dashboard}>
      {/* 4 Metric Cards */}
      <section className={styles.metricsGrid} aria-label="Ключевые показатели">
        {mockDashboardMetrics.map((metric) => (
          <StatCard key={metric.id} metric={metric} />
        ))}
      </section>

      {/* Middle Grid: Revenue Chart + Popular Products */}
      <section className={styles.twoColumnGrid} aria-label="Выручка и популярные товары">
        <div className={styles.chartCol}>
          <RevenueChart data={mockWeeklyRevenue} />
        </div>
        <div className={styles.sideCol}>
          <PopularProducts products={mockPopularProducts} />
        </div>
      </section>

      {/* Bottom Grid: Recent Sales + Low Stock Items */}
      <section className={styles.twoColumnGrid} aria-label="Последние продажи и остатки">
        <div className={styles.salesCol}>
          <RecentSales sales={mockRecentSales} />
        </div>
        <div className={styles.sideCol}>
          <LowStock items={mockLowStockItems} />
        </div>
      </section>
    </div>
  );
};
