import { CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';
import type { StockStatusReportItem, StockStatus } from '../../../types';
import { formatNumber } from '../../../utils/formatUtils';
import styles from './StockStatusReport.module.scss';

export interface StockStatusReportProps {
  items: StockStatusReportItem[];
}

const STATUS_ICONS: Record<StockStatus, typeof CheckCircle2> = {
  in_stock: CheckCircle2,
  low_stock: AlertTriangle,
  out_of_stock: XCircle,
};

const STATUS_CLASSES: Record<StockStatus, { icon: string; bar: string; badge: string }> = {
  in_stock: {
    icon: styles.iconInStock,
    bar: styles.barInStock,
    badge: styles.badgeInStock,
  },
  low_stock: {
    icon: styles.iconLowStock,
    bar: styles.barLowStock,
    badge: styles.badgeLowStock,
  },
  out_of_stock: {
    icon: styles.iconOutOfStock,
    bar: styles.barOutOfStock,
    badge: styles.badgeOutOfStock,
  },
};

export const StockStatusReport = ({ items }: StockStatusReportProps) => {
  return (
    <div className={styles.container}>
      <h3 className={styles.title}>Распределение по статусам остатков</h3>

      {/* Multi-segment progress bar */}
      <div className={styles.multiBarTrack} aria-label="Соотношение статусов остатков">
        {items.map((item) => (
          <div
            key={item.status}
            className={`${styles.barSegment} ${STATUS_CLASSES[item.status].bar}`}
            style={{ width: `${item.percentage}%` }}
            title={`${item.label}: ${item.count} поз. (${item.percentage.toFixed(1)}%)`}
          />
        ))}
      </div>

      <div className={styles.statusCardsGrid}>
        {items.map((item) => {
          const Icon = STATUS_ICONS[item.status];
          const classes = STATUS_CLASSES[item.status];

          return (
            <div key={item.status} className={styles.statusCard}>
              <div className={styles.cardHeader}>
                <div className={`${styles.iconBox} ${classes.icon}`}>
                  <Icon size={18} aria-hidden="true" />
                </div>
                <span className={styles.statusLabel}>{item.label}</span>
              </div>
              <div className={styles.cardValues}>
                <span className={styles.countText}>
                  {formatNumber(item.count)}&nbsp;поз.
                </span>
                <span className={`${styles.percentageBadge} ${classes.badge}`}>
                  {item.percentage.toFixed(1)}%
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
