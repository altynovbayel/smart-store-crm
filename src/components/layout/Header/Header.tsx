import { useState, type FormEvent } from 'react';
import { useLocation } from 'react-router-dom';
import { Menu, Search, Bell, ChevronDown } from 'lucide-react';
import styles from './Header.module.scss';

export interface HeaderProps {
  onOpenMobileMenu: () => void;
}

const pageTitles: Record<string, string> = {
  '/': 'Главная',
  '/sales': 'Продажи',
  '/income': 'Приход',
  '/outcome': 'Расход',
  '/warehouse': 'Склад',
  '/sales-history': 'История продаж',
  '/reports': 'Отчёты',
};

export const Header = ({ onOpenMobileMenu }: HeaderProps) => {
  const location = useLocation();
  const [searchQuery, setSearchQuery] = useState('');
  const [hasUnreadNotifications] = useState(true);

  const currentTitle = pageTitles[location.pathname] || 'Smart Store';

  // Format date in Russian, e.g. "23 сентября 2026"
  const formattedDate = new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date());

  const handleSearchSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      alert(`Поиск: "${searchQuery}" (демо-режим)`);
    }
  };

  return (
    <header className={styles.header}>
      <div className={styles.leftSection}>
        {/* Mobile menu trigger */}
        <button
          type="button"
          id="mobile-menu-trigger"
          className={styles.menuButton}
          onClick={onOpenMobileMenu}
          aria-label="Открыть меню навигации"
          aria-haspopup="dialog"
        >
          <Menu size={20} />
        </button>

        <div className={styles.titleGroup}>
          <h1 className={styles.pageTitle}>{currentTitle}</h1>
          <span className={styles.dateSeparator} aria-hidden="true" />
          <time className={styles.currentDate} dateTime={new Date().toISOString()}>
            {formattedDate}
          </time>
        </div>
      </div>

      <div className={styles.rightSection}>
        {/* Global Search Input */}
        <form className={styles.searchForm} onSubmit={handleSearchSubmit} role="search">
          <label htmlFor="global-search" className="visually-hidden">
            Поиск товара, клиента, чека
          </label>
          <div className={styles.searchFieldWrapper}>
            <Search size={16} className={styles.searchIcon} aria-hidden="true" />
            <input
              id="global-search"
              type="search"
              className={styles.searchInput}
              placeholder="Поиск товара, клиента, чека..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              autoComplete="off"
            />
          </div>
        </form>

        {/* Notifications Button */}
        <button
          type="button"
          className={styles.iconButton}
          aria-label="Уведомления"
          title="Уведомления"
          onClick={() => alert('У вас нет новых непрочитанных уведомлений')}
        >
          <Bell size={18} />
          {hasUnreadNotifications && (
            <span className={styles.notificationDot} aria-label="Есть непрочитанные уведомления" />
          )}
        </button>

        {/* User Account / Avatar Dropdown */}
        <button
          type="button"
          className={styles.userDropdownButton}
          aria-label="Профиль пользователя"
          onClick={() => alert('Меню профиля (Администратор)')}
        >
          <div className={styles.avatarCircle} aria-hidden="true">
            <span>A</span>
          </div>
          <ChevronDown size={14} className={styles.chevronIcon} aria-hidden="true" />
        </button>
      </div>
    </header>
  );
};
