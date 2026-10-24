import { supabase } from '../../lib/supabase';
import type {
  DashboardApiResult,
  DashboardSalesSummary,
  DashboardSalesSummaryArgs,
  DashboardStockSummary,
  DashboardStockSummaryArgs,
} from '../../types';
import { mapDashboardSalesSummary, mapDashboardStockSummary } from './dashboardMappers';
import { mapDashboardError } from './dashboardErrorMapper';

export const DASHBOARD_POPULAR_LIMIT = 4;
export const DASHBOARD_RECENT_LIMIT = 5;
export const DASHBOARD_LOW_STOCK_LIMIT = 8;

const isAbortError = (err: unknown): boolean =>
  err instanceof DOMException && err.name === 'AbortError';

/**
 * Read-only Dashboard API. Uses only the aggregation RPCs (migration 20261018150000):
 * no table SELECTs, no cost / purchase price / profit columns, no client-side receipt limit.
 */
export const dashboardApi = {
  /** Revenue per local day, top products and latest receipts for the given day bounds. */
  async fetchSalesSummary(
    dayBounds: string[],
    signal?: AbortSignal
  ): Promise<DashboardApiResult<DashboardSalesSummary>> {
    try {
      const args: DashboardSalesSummaryArgs = {
        p_day_bounds: dayBounds,
        p_popular_limit: DASHBOARD_POPULAR_LIMIT,
        p_recent_limit: DASHBOARD_RECENT_LIMIT,
      };
      let query = supabase.rpc('rpc_get_dashboard_sales_summary', args);
      if (signal) query = query.abortSignal(signal);

      const { data, error, status } = await query;
      if (error) {
        return { success: false, error: mapDashboardError({ ...error, status }) };
      }
      return { success: true, data: mapDashboardSalesSummary(data, dayBounds) };
    } catch (err: unknown) {
      if (isAbortError(err)) throw err;
      return { success: false, error: mapDashboardError(err) };
    }
  },

  /** Stock totals over all active products and the most critical low-stock items. */
  async fetchStockSummary(signal?: AbortSignal): Promise<DashboardApiResult<DashboardStockSummary>> {
    try {
      const args: DashboardStockSummaryArgs = { p_low_stock_limit: DASHBOARD_LOW_STOCK_LIMIT };
      let query = supabase.rpc('rpc_get_dashboard_stock_summary', args);
      if (signal) query = query.abortSignal(signal);

      const { data, error, status } = await query;
      if (error) {
        return { success: false, error: mapDashboardError({ ...error, status }) };
      }
      return { success: true, data: mapDashboardStockSummary(data) };
    } catch (err: unknown) {
      if (isAbortError(err)) throw err;
      return { success: false, error: mapDashboardError(err) };
    }
  },
};
