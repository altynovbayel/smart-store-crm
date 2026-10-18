import { useState, useMemo, useEffect, useCallback } from 'react';
import { Navigate } from 'react-router-dom';
import { AlertCircle, Download, RotateCcw } from 'lucide-react';
import type { ReportTab, ReportPeriod, ReportDateRange } from '../../types';
import { useAuth } from '../../context';
import { formatCalendarDateKey } from '../../utils/dateUtils';
import { exportSalesReportToCSV } from '../../utils/reportUtils';
import { buildReportPeriodBounds } from '../../utils/reportCalculations';
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
import { useReportsData } from './hooks/useReportsData';
import { useWarehouseExport } from './hooks/useWarehouseExport';
import styles from './ReportsPage.module.scss';

interface SourceErrorProps {
  message: string;
  retryAttr: 'data-retry-reports-sales-btn' | 'data-retry-reports-warehouse-btn';
  isBusy: boolean;
  onRetry: () => void;
}

const SourceError = ({ message, retryAttr, isBusy, onRetry }: SourceErrorProps) => (
  <div className={styles.errorBanner} role="alert">
    <div className={styles.errorInfo}>
      <AlertCircle size={20} />
      <span className={styles.errorText}>{message}</span>
    </div>
    <button
      type="button"
      {...{ [retryAttr]: '' }}
      className={styles.retryBtn}
      onClick={onRetry}
      disabled={isBusy}
    >
      <RotateCcw size={14} />
      <span>{isBusy ? 'Загрузка...' : 'Повторить'}</span>
    </button>
  </div>
);

const LoadingCard = ({ label }: { label: string }) => (
  <div className={styles.tableLoadingCard}>
    <div className={styles.spinner} role="progressbar" aria-label={label} />
    <span className={styles.loadingText}>{label}...</span>
  </div>
);

/**
 * Reports (admin only) work exclusively with the admin-only aggregation RPCs — no InventoryContext,
 * no mock data. Sales and warehouse tabs are independent sources; only the active tab loads.
 */
export const ReportsPage = () => {
  const { user, isAdmin } = useAuth();
  const userId = user?.id ?? null;

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

  // Validated local calendar bounds [from, before); null → invalid / incomplete custom range
  const salesPeriod = useMemo(
    () => buildReportPeriodBounds(period, dateRange, currentDateKey),
    [period, dateRange, currentDateKey]
  );

  const { sales, warehouse, retrySales, retryWarehouse } = useReportsData({
    userId,
    isAdmin,
    activeTab,
    salesPeriod,
  });

  const exporter = useWarehouseExport({ userId, isAdmin, currentDateKey });

  // Shown sales data always belongs to the currently selected period
  const salesData = salesPeriod && sales.dataKey === salesPeriod.key ? sales.data : null;
  const warehouseData = warehouse.data;

  // CSV of the sales report is built from exactly the daily series shown on the page
  const handleExportSalesReport = useCallback(() => {
    if (!salesData) return;
    exportSalesReportToCSV(salesData.daily, currentDateKey);
  }, [salesData, currentDateKey]);

  const { startExport } = exporter;
  const handleExportWarehouseReport = useCallback(() => {
    void startExport();
  }, [startExport]);

  if (!isAdmin) {
    return <Navigate to="/" replace />;
  }

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
          aria-busy={sales.isLoading || sales.isRefreshing}
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
            isExportDisabled={!salesData || sales.isLoading || sales.isRefreshing}
            exportButtonLabel="Экспорт отчёта по продажам"
          />

          {sales.isRefreshing && salesData && (
            <span className={styles.statusLine} role="status">
              Обновление данных...
            </span>
          )}

          {sales.error && salesPeriod && (
            <SourceError
              message={sales.error}
              retryAttr="data-retry-reports-sales-btn"
              isBusy={sales.isLoading || sales.isRefreshing}
              onRetry={retrySales}
            />
          )}

          {!salesPeriod ? (
            <p className={styles.emptyPeriodNote} role="status">
              Укажите корректный период (до 366 дней), чтобы сформировать отчёт.
            </p>
          ) : salesData ? (
            <>
              {salesData.summary.receiptsCount === 0 && (
                <p className={styles.emptyPeriodNote} role="status">
                  За выбранный период продаж нет.
                </p>
              )}

              {/* 6 Summary Stat Cards */}
              <SalesReportStats summary={salesData.summary} />

              {/* Main Visuals Grid: Chart + Payment Structure */}
              <div className={styles.salesVisualsGrid}>
                <div className={styles.chartCol}>
                  <RevenueReportChart data={salesData.daily} />
                </div>
                <div className={styles.paymentCol}>
                  <PaymentBreakdown items={salesData.payments} />
                </div>
              </div>

              {/* Popular Products Table */}
              <PopularProductsReport items={salesData.popularProducts} />
            </>
          ) : (
            sales.isLoading && <LoadingCard label="Загрузка отчёта по продажам" />
          )}
        </section>
      )}

      {/* WAREHOUSE REPORT TAB */}
      {activeTab === 'warehouse' && (
        <section
          id="panel-warehouse"
          role="tabpanel"
          aria-labelledby="tab-warehouse"
          aria-busy={warehouse.isLoading || warehouse.isRefreshing || exporter.isExporting}
          className={styles.tabPanel}
        >
          {/* Warehouse Toolbar with CSV Export */}
          <div className={styles.warehouseToolbar}>
            <div className={styles.warehouseToolbarInfo}>
              <span className={styles.liveBadge}>Реальное время</span>
              <span className={styles.liveSubtitle}>
                {warehouseData
                  ? `Показатели рассчитаны по ${warehouseData.summary.activePositionsCount} активным товарам на складе`
                  : 'Показатели рассчитываются по всем активным товарам на складе'}
              </span>
            </div>

            <button
              type="button"
              data-export-warehouse-btn
              className={styles.exportButton}
              onClick={handleExportWarehouseReport}
              disabled={
                exporter.isExporting ||
                !warehouseData ||
                warehouseData.summary.activePositionsCount === 0
              }
              aria-label="Экспортировать складской отчёт в CSV"
            >
              <Download size={16} aria-hidden="true" />
              <span>
                {exporter.isExporting
                  ? `Выгружено ${exporter.exportedCount} товаров...`
                  : 'Экспорт отчёта по складу'}
              </span>
            </button>
          </div>

          {exporter.isExporting && (
            <span className={styles.statusLine} role="status">
              Выгружено {exporter.exportedCount} товаров...
            </span>
          )}

          {exporter.error && (
            <div className={styles.errorBanner} role="alert">
              <div className={styles.errorInfo}>
                <AlertCircle size={20} />
                <span className={styles.errorText}>{exporter.error}</span>
              </div>
              <button
                type="button"
                data-retry-warehouse-export-btn
                className={styles.retryBtn}
                onClick={handleExportWarehouseReport}
                disabled={exporter.isExporting}
              >
                <RotateCcw size={14} />
                <span>Повторить экспорт</span>
              </button>
            </div>
          )}

          {warehouse.isRefreshing && warehouseData && (
            <span className={styles.statusLine} role="status">
              Обновление данных...
            </span>
          )}

          {warehouse.error && (
            <SourceError
              message={warehouse.error}
              retryAttr="data-retry-reports-warehouse-btn"
              isBusy={warehouse.isLoading || warehouse.isRefreshing}
              onRetry={retryWarehouse}
            />
          )}

          {warehouseData ? (
            <>
              {/* 5 Warehouse Metric Cards */}
              <WarehouseReportStats summary={warehouseData.summary} />

              {/* Category Stock & Status Distribution Grid */}
              <div className={styles.warehouseVisualsGrid}>
                <div className={styles.categoryCol}>
                  <CategoryStockReport items={warehouseData.categories} />
                </div>
                <div className={styles.statusCol}>
                  <StockStatusReport items={warehouseData.statuses} />
                </div>
              </div>

              {/* Attention Products Table */}
              <AttentionProductsTable
                items={warehouseData.attention}
                totalCount={warehouseData.attentionTotal}
              />
            </>
          ) : (
            warehouse.isLoading && <LoadingCard label="Загрузка отчёта по складу" />
          )}
        </section>
      )}
    </div>
  );
};
