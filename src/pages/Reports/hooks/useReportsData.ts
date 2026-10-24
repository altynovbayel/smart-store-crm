import { useEffect, useCallback, useRef } from 'react';
import type { ReportTab, SalesReportData, WarehouseReportData } from '../../../types';
import { reportsApi } from '../../../api/reports';
import type { ReportPeriodBounds } from '../../../utils/reportCalculations';
import { useReportSource } from './useReportSource';

interface UseReportsDataOptions {
  userId: string | null;
  isAdmin: boolean;
  activeTab: ReportTab;
  /** Validated period bounds; null for an invalid / incomplete custom range (no request). */
  salesPeriod: ReportPeriodBounds | null;
  /** Injectable clock for tests. */
  now?: () => number;
}

const systemNow = () => Date.now();
const WAREHOUSE_KEY = 'warehouse';

/**
 * Reports data from the admin-only RPCs. Sales and warehouse are independent sources:
 * - only the ACTIVE tab loads; the warehouse loads on the first visit of its tab;
 * - a loaded tab keeps its data; returning to it (or to the browser tab) refreshes it in the
 *   background only if the last successful load is at least 60 s old;
 * - sales reload (primary, data cleared) when the period, custom dates or calendar day change;
 * - an invalid custom range aborts and clears the sales data (no request);
 * - a user switch or loss of the admin role aborts everything and clears all data.
 */
export const useReportsData = ({
  userId,
  isAdmin,
  activeTab,
  salesPeriod,
  now = systemNow,
}: UseReportsDataOptions) => {
  // Stable clock: an inline `now` must never recreate loaders / effects on every render
  const nowRef = useRef(now);
  useEffect(() => {
    nowRef.current = now;
  }, [now]);
  const stableNow = useCallback(() => nowRef.current(), []);

  const enabled = Boolean(userId) && isAdmin;
  const resetKey = `${userId ?? ''}|${enabled ? 'admin' : 'none'}`;

  const sales = useReportSource<SalesReportData>({
    resetKey,
    retryButtonSelector: '[data-retry-reports-sales-btn]',
    successFocusSelector: '#tab-sales',
    now: stableNow,
  });
  const warehouse = useReportSource<WarehouseReportData>({
    resetKey,
    retryButtonSelector: '[data-retry-reports-warehouse-btn]',
    successFocusSelector: '#tab-warehouse',
    now: stableNow,
  });

  const salesPeriodRef = useRef(salesPeriod);
  useEffect(() => {
    salesPeriodRef.current = salesPeriod;
  }, [salesPeriod]);

  const { load: loadSalesSource, clear: clearSales, isStale: salesIsStale, getDataKey: salesDataKey, isInFlight: salesInFlight } = sales;
  const { load: loadWarehouseSource, isStale: warehouseIsStale, getDataKey: warehouseDataKey, isInFlight: warehouseInFlight } = warehouse;

  const loadSales = useCallback(
    (mode: 'primary' | 'background' | 'retry') => {
      const period = salesPeriodRef.current;
      if (!period) return;
      void loadSalesSource(
        period.key,
        (signal) => reportsApi.fetchSalesReport(period.bounds, period.dayKeys, signal),
        mode
      );
    },
    [loadSalesSource]
  );

  const loadWarehouse = useCallback(
    (mode: 'primary' | 'background' | 'retry') => {
      void loadWarehouseSource(WAREHOUSE_KEY, (signal) => reportsApi.fetchWarehouseReport(signal), mode);
    },
    [loadWarehouseSource]
  );

  const salesKey = salesPeriod?.key ?? null;

  // Sales: active tab only; new key → primary load; same key on return → background if stale
  useEffect(() => {
    if (!enabled || activeTab !== 'sales') return;
    if (salesKey === null) {
      clearSales();
      return;
    }
    if (salesDataKey() !== salesKey) {
      loadSales('primary');
    } else if (salesIsStale() && !salesInFlight()) {
      loadSales('background');
    }
  }, [enabled, activeTab, salesKey, resetKey, clearSales, loadSales, salesDataKey, salesIsStale, salesInFlight]);

  // Warehouse: first visit of its tab → primary; later visits → background if stale
  useEffect(() => {
    if (!enabled || activeTab !== 'warehouse') return;
    if (warehouseDataKey() !== WAREHOUSE_KEY) {
      if (!warehouseInFlight()) loadWarehouse('primary');
    } else if (warehouseIsStale() && !warehouseInFlight()) {
      loadWarehouse('background');
    }
  }, [enabled, activeTab, resetKey, loadWarehouse, warehouseDataKey, warehouseIsStale, warehouseInFlight]);

  // Returning to the browser tab: refresh only the active report tab, only if stale, no duplicates
  const activeTabRef = useRef(activeTab);
  useEffect(() => {
    activeTabRef.current = activeTab;
  }, [activeTab]);

  useEffect(() => {
    if (!enabled) return;
    const handleReturn = () => {
      if (document.visibilityState === 'hidden') return;
      if (activeTabRef.current === 'sales') {
        const period = salesPeriodRef.current;
        if (period && salesDataKey() === period.key && salesIsStale() && !salesInFlight()) {
          loadSales('background');
        }
      } else if (warehouseDataKey() === WAREHOUSE_KEY && warehouseIsStale() && !warehouseInFlight()) {
        loadWarehouse('background');
      }
    };
    window.addEventListener('focus', handleReturn);
    document.addEventListener('visibilitychange', handleReturn);
    return () => {
      window.removeEventListener('focus', handleReturn);
      document.removeEventListener('visibilitychange', handleReturn);
    };
  }, [enabled, loadSales, loadWarehouse, salesDataKey, salesIsStale, salesInFlight, warehouseDataKey, warehouseIsStale, warehouseInFlight]);

  const retrySales = useCallback(() => loadSales('retry'), [loadSales]);
  const retryWarehouse = useCallback(() => loadWarehouse('retry'), [loadWarehouse]);

  return {
    sales: sales.state,
    warehouse: warehouse.state,
    retrySales,
    retryWarehouse,
  };
};
