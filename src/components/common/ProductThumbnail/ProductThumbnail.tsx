import type { ProductIconType } from '../../../types';
import styles from './ProductThumbnail.module.scss';

export interface ProductThumbnailProps {
  type: ProductIconType;
  alt?: string;
  size?: 'sm' | 'md' | 'lg';
}

export const ProductThumbnail = ({
  type,
  size = 'md',
}: ProductThumbnailProps) => {
  return (
    <div className={`${styles.thumbnail} ${styles[size]}`} aria-hidden="true">
      {type === 'phone' && (
        <svg viewBox="0 0 40 40" fill="none" className={styles.svgIcon}>
          <rect x="12" y="5" width="16" height="30" rx="3.5" fill="#1e293b" />
          <rect x="14" y="7" width="6" height="7" rx="1.5" fill="#0f172a" />
          <circle cx="16" cy="9" r="1.2" fill="#334155" />
          <circle cx="18" cy="9" r="1.2" fill="#334155" />
          <circle cx="17" cy="12" r="1.2" fill="#334155" />
          <path d="M14 18h12v1H14z" fill="#334155" opacity="0.4" />
        </svg>
      )}

      {type === 'cable' && (
        <svg viewBox="0 0 40 40" fill="none" className={styles.svgIcon}>
          <path
            d="M8 28C14 28 14 12 22 12C28 12 28 26 34 26"
            stroke="#1e293b"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
          <rect x="6" y="25.5" width="5" height="5" rx="1" fill="#475569" transform="rotate(-15 6 25.5)" />
          <rect x="3" y="27" width="3" height="2.5" rx="0.5" fill="#94a3b8" transform="rotate(-15 3 27)" />
          <rect x="30" y="23" width="5" height="5" rx="1" fill="#475569" transform="rotate(20 30 23)" />
          <rect x="35" y="24.5" width="3" height="2.5" rx="0.5" fill="#94a3b8" transform="rotate(20 35 24.5)" />
        </svg>
      )}

      {type === 'glass' && (
        <svg viewBox="0 0 40 40" fill="none" className={styles.svgIcon}>
          <rect x="13" y="6" width="14" height="28" rx="2.5" fill="#ffffff" stroke="#94a3b8" strokeWidth="1.5" />
          <path d="M18 8h4" stroke="#64748b" strokeWidth="1" strokeLinecap="round" />
          <path d="M15 12l8 16" stroke="#0ea5e9" strokeWidth="1" strokeOpacity="0.5" strokeLinecap="round" />
          <path d="M18 10l6 12" stroke="#e0f2fe" strokeWidth="1.5" strokeOpacity="0.8" strokeLinecap="round" />
        </svg>
      )}

      {type === 'powerbank' && (
        <svg viewBox="0 0 40 40" fill="none" className={styles.svgIcon}>
          <rect x="12" y="7" width="16" height="26" rx="2.5" fill="#0f172a" />
          <rect x="15" y="5.5" width="3" height="1.5" rx="0.5" fill="#64748b" />
          <rect x="22" y="5.5" width="3" height="1.5" rx="0.5" fill="#64748b" />
          <circle cx="16" cy="29" r="0.8" fill="#0ea5e9" />
          <circle cx="18.5" cy="29" r="0.8" fill="#0ea5e9" />
          <circle cx="21" cy="29" r="0.8" fill="#0ea5e9" />
          <circle cx="23.5" cy="29" r="0.8" fill="#334155" />
          <rect x="16" y="20" width="8" height="4" rx="0.5" fill="#1e293b" />
        </svg>
      )}

      {type === 'earphones' && (
        <svg viewBox="0 0 40 40" fill="none" className={styles.svgIcon}>
          <rect x="12" y="14" width="16" height="16" rx="5" fill="#f8fafc" stroke="#cbd5e1" strokeWidth="1.5" />
          <path d="M12 19h16" stroke="#94a3b8" strokeWidth="1" />
          <circle cx="20" cy="23" r="1" fill="#16a34a" />
          <rect x="15" y="9" width="3" height="5" rx="1.5" fill="#e2e8f0" />
          <rect x="22" y="9" width="3" height="5" rx="1.5" fill="#e2e8f0" />
        </svg>
      )}

      {type === 'adapter' && (
        <svg viewBox="0 0 40 40" fill="none" className={styles.svgIcon}>
          <rect x="13" y="14" width="14" height="16" rx="2" fill="#ffffff" stroke="#cbd5e1" strokeWidth="1.5" />
          <rect x="16" y="8" width="2" height="6" rx="1" fill="#94a3b8" />
          <rect x="22" y="8" width="2" height="6" rx="1" fill="#94a3b8" />
          <rect x="17" y="23" width="6" height="2" rx="1" fill="#0ea5e9" opacity="0.8" />
        </svg>
      )}

      {type === 'sdcard' && (
        <svg viewBox="0 0 40 40" fill="none" className={styles.svgIcon}>
          <path
            d="M13 11h11l3 4v14h-14z"
            fill="#1e293b"
            stroke="#0f172a"
            strokeWidth="1"
          />
          <rect x="15" y="13" width="1.5" height="3" fill="#eab308" />
          <rect x="18" y="13" width="1.5" height="3" fill="#eab308" />
          <rect x="21" y="13" width="1.5" height="3" fill="#eab308" />
          <rect x="15" y="21" width="8" height="4" rx="0.5" fill="#ef4444" opacity="0.8" />
        </svg>
      )}

      {type === 'holder' && (
        <svg viewBox="0 0 40 40" fill="none" className={styles.svgIcon}>
          {/* Car mount illustration */}
          <circle cx="20" cy="18" r="9" fill="#1e293b" />
          <circle cx="20" cy="18" r="5" fill="#334155" />
          <rect x="8" y="15" width="4" height="6" rx="1.5" fill="#475569" />
          <rect x="28" y="15" width="4" height="6" rx="1.5" fill="#475569" />
          <path d="M18 27h4v6h-4z" fill="#0f172a" />
        </svg>
      )}
    </div>
  );
};
