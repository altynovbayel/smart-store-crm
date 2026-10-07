import { useRef, type KeyboardEvent } from 'react';
import { ShoppingCart, Package } from 'lucide-react';
import type { ReportTab } from '../../../types';
import styles from './ReportTabs.module.scss';

export interface ReportTabsProps {
  activeTab: ReportTab;
  onTabChange: (tab: ReportTab) => void;
}

const TABS: ReportTab[] = ['sales', 'warehouse'];

export const ReportTabs = ({ activeTab, onTabChange }: ReportTabsProps) => {
  const salesBtnRef = useRef<HTMLButtonElement>(null);
  const warehouseBtnRef = useRef<HTMLButtonElement>(null);

  const buttonRefs: Record<ReportTab, React.RefObject<HTMLButtonElement | null>> = {
    sales: salesBtnRef,
    warehouse: warehouseBtnRef,
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLButtonElement>, currentTab: ReportTab) => {
    const currentIndex = TABS.indexOf(currentTab);
    let targetTab: ReportTab | null = null;

    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      const nextIndex = (currentIndex + 1) % TABS.length;
      targetTab = TABS[nextIndex];
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      const prevIndex = (currentIndex - 1 + TABS.length) % TABS.length;
      targetTab = TABS[prevIndex];
    } else if (e.key === 'Home') {
      e.preventDefault();
      targetTab = TABS[0];
    } else if (e.key === 'End') {
      e.preventDefault();
      targetTab = TABS[TABS.length - 1];
    }

    if (targetTab) {
      onTabChange(targetTab);
      buttonRefs[targetTab].current?.focus();
    }
  };

  return (
    <div className={styles.tabsWrapper} role="tablist" aria-label="Разделы отчётов">
      <button
        ref={salesBtnRef}
        type="button"
        role="tab"
        id="tab-sales"
        aria-selected={activeTab === 'sales'}
        aria-controls="panel-sales"
        tabIndex={activeTab === 'sales' ? 0 : -1}
        className={`${styles.tabBtn} ${activeTab === 'sales' ? styles.tabBtnActive : ''}`}
        onClick={() => onTabChange('sales')}
        onKeyDown={(e) => handleKeyDown(e, 'sales')}
      >
        <ShoppingCart size={18} aria-hidden="true" />
        <span>Отчёт по продажам</span>
      </button>

      <button
        ref={warehouseBtnRef}
        type="button"
        role="tab"
        id="tab-warehouse"
        aria-selected={activeTab === 'warehouse'}
        aria-controls="panel-warehouse"
        tabIndex={activeTab === 'warehouse' ? 0 : -1}
        className={`${styles.tabBtn} ${activeTab === 'warehouse' ? styles.tabBtnActive : ''}`}
        onClick={() => onTabChange('warehouse')}
        onKeyDown={(e) => handleKeyDown(e, 'warehouse')}
      >
        <Package size={18} aria-hidden="true" />
        <span>Отчёт по складу</span>
      </button>
    </div>
  );
};
