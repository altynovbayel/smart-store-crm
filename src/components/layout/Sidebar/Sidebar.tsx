import { useState, useEffect, useRef } from 'react';
import { NavLink } from 'react-router-dom';
import {
  Home,
  ShoppingCart,
  ArrowDownToLine,
  ArrowUpFromLine,
  Package,
  Clock,
  BarChart3,
  Settings,
  LogOut,
  X,
} from 'lucide-react';
import styles from './Sidebar.module.scss';

export interface NavItem {
  to: string;
  label: string;
  icon: typeof Home;
}

const navItems: NavItem[] = [
  { to: '/', label: 'Главная', icon: Home },
  { to: '/sales', label: 'Продажи', icon: ShoppingCart },
  { to: '/income', label: 'Приход', icon: ArrowDownToLine },
  { to: '/outcome', label: 'Расход', icon: ArrowUpFromLine },
  { to: '/warehouse', label: 'Склад', icon: Package },
  { to: '/sales-history', label: 'История продаж', icon: Clock },
  { to: '/reports', label: 'Отчёты', icon: BarChart3 },
];

export interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

export const Sidebar = ({ isOpen, onClose }: SidebarProps) => {
  const sidebarRef = useRef<HTMLElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  // Track viewport mode reactively on resize
  const [isMobile, setIsMobile] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return window.matchMedia('(max-width: 1023px)').matches;
    }
    return false;
  });

  // Track if focus is currently inside the sidebar to never apply aria-hidden to a focused element
  const [isFocusInside, setIsFocusInside] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 1023px)');
    const handleMediaChange = (e: MediaQueryListEvent) => {
      setIsMobile(e.matches);
    };

    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener('change', handleMediaChange);
    } else {
      mediaQuery.addListener(handleMediaChange);
    }

    return () => {
      if (mediaQuery.removeEventListener) {
        mediaQuery.removeEventListener('change', handleMediaChange);
      } else {
        mediaQuery.removeListener(handleMediaChange);
      }
    };
  }, []);

  // Handle focus trap, initial focus, and focus restoration when mobile drawer opens/closes
  useEffect(() => {
    if (!isMobile) {
      return;
    }

    if (!isOpen) {
      // Restore focus to button after drawer closes
      if (previousFocusRef.current && document.contains(previousFocusRef.current)) {
        previousFocusRef.current.focus();
        previousFocusRef.current = null;
      } else {
        const menuBtn = document.getElementById('mobile-menu-trigger');
        menuBtn?.focus();
      }
      return;
    }

    // Save active element before drawer opens
    if (document.activeElement instanceof HTMLElement) {
      previousFocusRef.current = document.activeElement;
    }

    // Immediate focus on close button inside drawer
    const closeBtn = sidebarRef.current?.querySelector<HTMLElement>(
      `.${styles.closeDrawerButton}`
    );
    closeBtn?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
        return;
      }

      // Focus trap inside mobile drawer
      if (event.key === 'Tab' && sidebarRef.current) {
        const focusableElements = sidebarRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );

        if (focusableElements.length === 0) return;

        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];

        if (event.shiftKey) {
          if (document.activeElement === firstElement) {
            event.preventDefault();
            lastElement.focus();
          }
        } else {
          if (document.activeElement === lastElement) {
            event.preventDefault();
            firstElement.focus();
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, isMobile, onClose]);

  // Lock body scroll when mobile drawer is open
  useEffect(() => {
    if (isMobile && isOpen) {
      document.body.classList.add('drawer-open');
    } else {
      document.body.classList.remove('drawer-open');
    }

    return () => {
      document.body.classList.remove('drawer-open');
    };
  }, [isOpen, isMobile]);

  const handleLinkClick = () => {
    if (isMobile && isOpen) {
      onClose();
    }
  };

  const handleFocus = () => {
    setIsFocusInside(true);
  };

  const handleBlur = (e: React.FocusEvent) => {
    if (!sidebarRef.current?.contains(e.relatedTarget as Node | null)) {
      setIsFocusInside(false);
    }
  };

  const isMobileClosed = isMobile && !isOpen;
  const shouldAriaHide = isMobileClosed && !isFocusInside;
  const shouldInert = isMobileClosed;

  return (
    <>
      {/* Mobile Backdrop Overlay */}
      <div
        className={`${styles.overlay} ${isOpen ? styles.overlayVisible : ''}`}
        onClick={onClose}
        aria-hidden="true"
      />

      <aside
        ref={sidebarRef}
        className={`${styles.sidebar} ${isOpen ? styles.sidebarOpen : ''}`}
        aria-label="Боковое меню"
        role={isMobile && isOpen ? 'dialog' : undefined}
        aria-modal={isMobile && isOpen ? true : undefined}
        aria-hidden={shouldAriaHide ? true : undefined}
        inert={shouldInert ? true : undefined}
        onFocus={handleFocus}
        onBlur={handleBlur}
      >
        {/* Brand Header */}
        <div className={styles.brandContainer}>
          <div className={styles.logoBadge} aria-hidden="true">
            <span className={styles.logoLetter}>S</span>
          </div>
          <div className={styles.brandText}>
            <span className={styles.brandTitle}>Smart Store</span>
            <span className={styles.brandSubtitle}>Система учёта</span>
          </div>

          {/* Close button for mobile drawer */}
          <button
            type="button"
            className={styles.closeDrawerButton}
            onClick={onClose}
            aria-label="Закрыть меню"
          >
            <X size={20} />
          </button>
        </div>

        {/* Navigation Menu */}
        <nav className={styles.navigation} aria-label="Основная навигация">
          <ul className={styles.navList}>
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <li key={item.to} className={styles.navItem}>
                  <NavLink
                    to={item.to}
                    end={item.to === '/'}
                    className={({ isActive }) =>
                      `${styles.navLink} ${isActive ? styles.navLinkActive : ''}`
                    }
                    onClick={handleLinkClick}
                  >
                    <Icon size={18} className={styles.navIcon} aria-hidden="true" />
                    <span className={styles.navLabel}>{item.label}</span>
                  </NavLink>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* User Profile Footer */}
        <div className={styles.userFooter}>
          <div className={styles.userInfo}>
            <div className={styles.userAvatar} aria-hidden="true">
              <Settings size={18} className={styles.gearIcon} />
            </div>
            <div className={styles.userMeta}>
              <span className={styles.userName}>Администратор</span>
              <span className={styles.userRole}>Полный доступ</span>
            </div>
          </div>
          <button
            type="button"
            className={styles.logoutButton}
            title="Выйти из системы"
            aria-label="Выйти из системы"
            onClick={() => {
              alert('Выход из системы (в этапе 1 действие не активно)');
            }}
          >
            <LogOut size={16} />
          </button>
        </div>
      </aside>
    </>
  );
};
