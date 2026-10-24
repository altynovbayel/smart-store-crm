import { supabase } from '../../lib/supabase';
import type {
  MappedApiError,
  SalesReportData,
  SalesReportRpcArgs,
  WarehouseExportPage,
  WarehouseReportData,
  WarehouseReportExportRpcArgs,
  WarehouseReportRpcArgs,
} from '../../types';
import { mapSalesReport, mapWarehouseExportPage, mapWarehouseReport } from './reportsMappers';
import { mapReportsError } from './reportsErrorMapper';

export const REPORTS_TOP_PRODUCTS_LIMIT = 5;
export const REPORTS_ATTENTION_LIMIT = 50;
export const REPORTS_EXPORT_PAGE_SIZE = 1000;

export type ReportsApiResult<T> =
  | { success: true; data: T }
  | { success: false; error: MappedApiError };

const isAbortError = (err: unknown): boolean =>
  err instanceof DOMException && err.name === 'AbortError';

export interface WarehouseExportPageRequest {
  /** null on the first page; then the snapshot_at returned by the first page. */
  snapshotAt: string | null;
  afterId: string | null;
  limit?: number;
}

/**
 * Admin-only Reports API (migration 20261018180000). Uses only the read-only aggregation RPCs;
 * the server rejects non-admin users with 42501.
 */
export const reportsApi = {
  /** Sales report for N + 1 local-midnight bounds (N = 1..366 days). */
  async fetchSalesReport(
    bounds: string[],
    dayKeys: string[],
    signal?: AbortSignal
  ): Promise<ReportsApiResult<SalesReportData>> {
    try {
      const args: SalesReportRpcArgs = { p_day_bounds: bounds, p_top_limit: REPORTS_TOP_PRODUCTS_LIMIT };
      let query = supabase.rpc('rpc_get_sales_report', args);
      if (signal) query = query.abortSignal(signal);

      const { data, error, status } = await query;
      if (error) return { success: false, error: mapReportsError({ ...error, status }) };
      return { success: true, data: mapSalesReport(data, bounds, dayKeys) };
    } catch (err: unknown) {
      if (isAbortError(err)) throw err;
      return { success: false, error: mapReportsError(err) };
    }
  },

  /** Warehouse report over all active products (first 50 attention products). */
  async fetchWarehouseReport(signal?: AbortSignal): Promise<ReportsApiResult<WarehouseReportData>> {
    try {
      const args: WarehouseReportRpcArgs = { p_attention_limit: REPORTS_ATTENTION_LIMIT };
      let query = supabase.rpc('rpc_get_warehouse_report', args);
      if (signal) query = query.abortSignal(signal);

      const { data, error, status } = await query;
      if (error) return { success: false, error: mapReportsError({ ...error, status }) };
      return { success: true, data: mapWarehouseReport(data) };
    } catch (err: unknown) {
      if (isAbortError(err)) throw err;
      return { success: false, error: mapReportsError(err) };
    }
  },

  /** One keyset page (≤ 1000 rows) of the warehouse CSV export. */
  async fetchWarehouseExportPage(
    request: WarehouseExportPageRequest,
    signal?: AbortSignal
  ): Promise<ReportsApiResult<WarehouseExportPage>> {
    const limit = request.limit ?? REPORTS_EXPORT_PAGE_SIZE;
    try {
      const args: WarehouseReportExportRpcArgs = { p_limit: limit };
      if (request.snapshotAt !== null) args.p_snapshot_at = request.snapshotAt;
      if (request.afterId !== null) args.p_after_id = request.afterId;

      let query = supabase.rpc('rpc_get_warehouse_report_export', args);
      if (signal) query = query.abortSignal(signal);

      const { data, error, status } = await query;
      if (error) return { success: false, error: mapReportsError({ ...error, status }) };
      return { success: true, data: mapWarehouseExportPage(data, limit) };
    } catch (err: unknown) {
      if (isAbortError(err)) throw err;
      return { success: false, error: mapReportsError(err) };
    }
  },
};
