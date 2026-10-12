import styles from './PageLoader.module.scss';

export interface PageLoaderProps {
  message?: string;
}

export const PageLoader = ({ message = 'Загрузка системы...' }: PageLoaderProps) => {
  return (
    <div className={styles.loaderContainer} role="status" aria-live="polite">
      <div className={styles.brandWrapper}>
        <div className={styles.logoBadge} aria-hidden="true">
          <span className={styles.logoLetter}>S</span>
        </div>
        <div className={styles.spinner} aria-hidden="true" />
      </div>
      <p className={styles.loaderMessage}>{message}</p>
    </div>
  );
};
