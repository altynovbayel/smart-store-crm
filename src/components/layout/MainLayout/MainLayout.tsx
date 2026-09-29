import { useState, useCallback } from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from '../Sidebar/Sidebar';
import { Header } from '../Header/Header';
import styles from './MainLayout.module.scss';

export const MainLayout = () => {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const handleOpenMobileMenu = useCallback(() => {
    setIsMobileMenuOpen(true);
  }, []);

  const handleCloseMobileMenu = useCallback(() => {
    setIsMobileMenuOpen(false);
  }, []);

  return (
    <div className={styles.layoutWrapper}>
      {/* Desktop & Mobile Drawer Sidebar */}
      <Sidebar isOpen={isMobileMenuOpen} onClose={handleCloseMobileMenu} />

      {/* Main Content Area */}
      <div className={styles.contentArea}>
        <Header onOpenMobileMenu={handleOpenMobileMenu} />
        <main id="main-content" className={styles.pageContainer}>
          <Outlet />
        </main>
      </div>
    </div>
  );
};
