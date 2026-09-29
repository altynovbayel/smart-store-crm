import type { ReactNode } from 'react';
import styles from './Card.module.scss';

export interface CardProps {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  padding?: 'none' | 'sm' | 'md' | 'lg';
}

export const Card = ({
  title,
  action,
  children,
  className = '',
  padding = 'md',
}: CardProps) => {
  return (
    <section className={`${styles.card} ${styles[`padding-${padding}`]} ${className}`}>
      {(title || action) && (
        <header className={styles.header}>
          {title && <h2 className={styles.title}>{title}</h2>}
          {action && <div className={styles.action}>{action}</div>}
        </header>
      )}
      <div className={styles.content}>{children}</div>
    </section>
  );
};
