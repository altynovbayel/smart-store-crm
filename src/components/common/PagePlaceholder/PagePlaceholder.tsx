import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Clock } from 'lucide-react';
import styles from './PagePlaceholder.module.scss';

export interface PagePlaceholderProps {
  title: string;
  subtitle: string;
  icon?: ReactNode;
}

export const PagePlaceholder = ({
  title,
  subtitle,
  icon,
}: PagePlaceholderProps) => {
  return (
    <div className={styles.container}>
      <div className={styles.card}>
        <div className={styles.iconWrapper}>
          {icon ?? <Clock size={32} className={styles.defaultIcon} />}
        </div>
        <h1 className={styles.title}>{title}</h1>
        <p className={styles.subtitle}>{subtitle}</p>
        <div className={styles.metaBadge}>
          <span>Этап 1: Главная и навигация</span>
        </div>
        <div className={styles.actions}>
          <Link to="/" className={styles.primaryButton}>
            <ArrowLeft size={16} />
            <span>Вернуться на Главную</span>
          </Link>
        </div>
      </div>
    </div>
  );
};
