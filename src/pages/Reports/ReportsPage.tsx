import { useState, useMemo, useEffect, useCallback } from 'react';
import { Download } from 'lucide-react';
import type {
  ReportTab,
  ReportPeriod,
  ReportDateRange,
} from '../../types';
import { useInventory } from '../../context';
import { formatCalendarDateKey } from '../../utils/dateUtils';
import {
  filterSalesByReportPeriod,
  calculateSalesReportSummary,
  generateDailyRevenueDataPoints,
  calculatePaymentBreakdown,
  calculatePopularProductsReport,
  calculateWarehouseReportSummary,
  calculateCategoryStockReport,
  calculateStockStatusReport,
  getAttentionProducts,
  exportSalesReportToCSV,
  exportWarehouseReportToCSV,
} from '../../utils/reportUtils';
import {
  ReportTabs,
  ReportPeriodFilter,
  SalesReportStats,
  RevenueReportChart,
  PaymentBreakdown,
  PopularProductsReport,
  WarehouseReportStats,
  StockStatusReport,
  CategoryStockReport,
  AttentionProductsTable,
} from '../../components/reports';
import styles from './ReportsPage.module.scss';

export const ReportsPage = () => {
  const { sales, activeProducts } = useInventory();

  // Active Tab state
  const [activeTab, setActiveTab] = useState<ReportTab>('sales');

  // Sales period state
  const [period, setPeriod] = useState<ReportPeriod>('week');
  const [dateRange, setDateRange] = useState<ReportDateRange>({
    from: '',
    to: '',
  });

  // Calendar date key (YYYY-MM-DD) with auto-refresh across midnight / tab focus
  const [currentDateKey, setCurrentDateKey] = useState(() =>
    formatCalendarDateKey(new Date())
  );

  useEffect(() => {
    const updateDate = () => {
      const newKey = formatCalendarDateKey(new Date());
      setCurrentDateKey((prev) => (prev !== newKey ? newKey : prev));
    };

    const handleFocus = () => updateDate();
    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleFocus);
    const interval = setInterval(updateDate, 30_000);

    return () => {
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleFocus);
      clearInterval(interval);
    };
  }, []);

  // --- Sales Report Calculations ---
  const periodSales = useMemo(() => {
    return filterSalesByReportPeriod(sales, period, dateRange, currentDateKey);
  }, [sales, period, dateRange, currentDateKey]);

  const salesSummary = useMemo(() => {
    return calculateSalesReportSummary(periodSales);
  }, [periodSales]);

  const dailyRevenuePoints = useMemo(() => {
    return generateDailyRevenueDataPoints(
      periodSales,
      period,
      dateRange,
      currentDateKey
    );
  }, [periodSales, period, dateRange, currentDateKey]);

  const paymentBreakdown = useMemo(() => {
    return calculatePaymentBreakdown(periodSales);
  }, [periodSales]);

  const popularProducts = useMemo(() => {
    return calculatePopularProductsReport(periodSales);
  }, [periodSales]);

  // --- Warehouse Report Calculations ---
  const warehouseSummary = useMemo(() => {
    return calculateWarehouseReportSummary(activeProducts);
  }, [activeProducts]);

  const categoryBreakdown = useMemo(() => {
    return calculateCategoryStockReport(activeProducts);
  }, [activeProducts]);

  const stockStatusBreakdown = useMemo(() => {
    return calculateStockStatusReport(activeProducts);
  }, [activeProducts]);

  const attentionProducts = useMemo(() => {
    return getAttentionProducts(activeProducts);
  }, [activeProducts]);

  // --- Handlers ---
  const handleExportSalesReport = useCallback(() => {
    exportSalesReportToCSV(dailyRevenuePoints, currentDateKey);
  }, [dailyRevenuePoints, currentDateKey]);

  const handleExportWarehouseReport = useCallback(() => {
    exportWarehouseReportToCSV(activeProducts, currentDateKey);
  }, [activeProducts, currentDateKey]);

  return (
    <div className={styles.reportsPage}>
      {/* Header */}
      <div className={styles.pageHeader}>
        <div className={styles.headerTitles}>
          <h1 className={styles.title}>Отчёты и аналитика</h1>
          <p className={styles.subtitle}>
            Анализ динамики продаж, доходности, оборачиваемости и складских запасов
          </p>
        </div>

        {/* Tab switcher */}
        <ReportTabs activeTab={activeTab} onTabChange={setActiveTab} />
      </div>

      {/* SALES REPORT TAB */}
      {activeTab === 'sales' && (
        <section
          id="panel-sales"
          role="tabpanel"
          aria-labelledby="tab-sales"
          className={styles.tabPanel}
        >
          {/* Period Filter & CSV Export */}
          <ReportPeriodFilter
            period={period}
            onPeriodChange={setPeriod}
            dateRange={dateRange}
            onDateRangeChange={setDateRange}
            currentDateKey={currentDateKey}
            onExportCSV={handleExportSalesReport}
            isExportDisabled={dailyRevenuePoints.length === 0}
            exportButtonLabel="Экспорт отчёта по продажам"
          />

          {/* 6 Summary Stat Cards */}
          <SalesReportStats summary={salesSummary} />

          {/* Main Visuals Grid: Chart + Payment Structure */}
          <div className={styles.salesVisualsGrid}>
            <div className={styles.chartCol}>
              <RevenueReportChart data={dailyRevenuePoints} />
            </div>
            <div className={styles.paymentCol}>
              <PaymentBreakdown items={paymentBreakdown} />
            </div>
          </div>

          {/* Popular Products Table */}
          <PopularProductsReport items={popularProducts} />
        </section>
      )}

      {/* WAREHOUSE REPORT TAB */}
      {activeTab === 'warehouse' && (
        <section
          id="panel-warehouse"
          role="tabpanel"
          aria-labelledby="tab-warehouse"
          className={styles.tabPanel}
        >
          {/* Warehouse Toolbar with CSV Export */}
          <div className={styles.warehouseToolbar}>
            <div className={styles.warehouseToolbarInfo}>
              <span className={styles.liveBadge}>Реальное время</span>
              <span className={styles.liveSubtitle}>
                Показатели рассчитаны по {activeProducts.length} активным товарам на складе
              </span>
            </div>

            <button
              type="button"
              className={styles.exportButton}
              onClick={handleExportWarehouseReport}
              disabled={activeProducts.length === 0}
              aria-label="Экспортировать складской отчёт в CSV"
            >
              <Download size={16} aria-hidden="true" />
              <span>Экспорт отчёта по складу</span>
            </button>
          </div>

          {/* 5 Warehouse Metric Cards */}
          <WarehouseReportStats summary={warehouseSummary} />

          {/* Category Stock & Status Distribution Grid */}
          <div className={styles.warehouseVisualsGrid}>
            <div className={styles.categoryCol}>
              <CategoryStockReport items={categoryBreakdown} />
            </div>
            <div className={styles.statusCol}>
              <StockStatusReport items={stockStatusBreakdown} />
            </div>
          </div>

          {/* Attention Products Table */}
          <AttentionProductsTable items={attentionProducts} />
        </section>
      )}
    </div>
  );
};
