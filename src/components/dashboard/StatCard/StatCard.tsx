import {
  BarChart2,
  ShoppingCart,
  Package,
  AlertTriangle,
  ArrowUpRight,
  ArrowDownRight,
} from 'lucide-react';
import type { DashboardMetric } from '../../../types';
import styles from './StatCard.module.scss';

export interface StatCardProps {
  metric: DashboardMetric;
}

export const StatCard = ({ metric }: StatCardProps) => {
  const renderIcon = () => {
    switch (metric.icon) {
      case 'revenue':
        return <BarChart2 size={24} className={styles.iconRevenue} />;
      case 'sales':
        return <ShoppingCart size={24} className={styles.iconSales} />;
      case 'warehouse':
        return <Package size={24} className={styles.iconWarehouse} />;
      case 'alert':
        return <AlertTriangle size={24} className={styles.iconAlert} />;
      default:
        return null;
    }
  };

  const isPositive = metric.trendType === 'positive';

  return (
    <div className={styles.card}>
      <div className={`${styles.iconContainer} ${styles[`type-${metric.icon}`]}`} aria-hidden="true">
        {renderIcon()}
      </div>

      <div className={styles.details}>
        <span className={styles.title}>{metric.title}</span>
        <span className={styles.value}>{metric.value}</span>

        <div className={styles.trendRow}>
          <span
            className={`${styles.trendBadge} ${
              isPositive ? styles.trendPositive : styles.trendNegative
            }`}
          >
            {isPositive ? (
              <ArrowUpRight size={14} className={styles.trendIcon} aria-hidden="true" />
            ) : (
              <ArrowDownRight size={14} className={styles.trendIcon} aria-hidden="true" />
            )}
            <span className={styles.trendValue}>{metric.trendText.split(' ')[0]}</span>
          </span>
          <span className={styles.trendPeriod}>
            {metric.trendText.split(' ').slice(1).join(' ')}
          </span>
        </div>
      </div>
    </div>
  );
};
