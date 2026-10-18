import { useState, useEffect, useCallback, useRef } from 'react';
import type { WarehouseExportRow } from '../../../types';
import { reportsApi, REPORTS_EXPORT_PAGE_SIZE } from '../../../api/reports';
import { downloadWarehouseExportCSV } from '../../../utils/reportCalculations';

interface UseWarehouseExportOptions {
  userId: string | null;
  isAdmin: boolean;
  currentDateKey: string;
  /** Injectable downloader for tests (default: browser CSV download). */
  download?: (rows: readonly WarehouseExportRow[], currentDateKey: string) => void;
}

export interface WarehouseExportState {
  isExporting: boolean;
  exportedCount: number;
  error: string | null;
}

const IDLE: WarehouseExportState = { isExporting: false, exportedCount: 0, error: null };

/** Focus targets restored when the focused retry / export button disappeared or got disabled. */
export const EXPORT_BUTTON_SELECTOR = '[data-export-warehouse-btn]';
export const EXPORT_RETRY_BUTTON_SELECTOR = '[data-retry-warehouse-export-btn]';

/**
 * After the export finishes, returns focus to the given button only if focus was lost
 * (the retry banner was removed / the export button was disabled) — never steals user focus.
 */
const restoreLostFocus = (selector: string) => {
  requestAnimationFrame(() => {
    const active = document.activeElement;
    if (active && active !== document.body) return;
    const target = document.querySelector<HTMLButtonElement>(selector);
    if (target && !target.disabled) target.focus();
  });
};

const INCONSISTENT_EXPORT =
  'Выгрузка склада прервана: сервер вернул несогласованные страницы. Файл не создан — повторите экспорт.';

/**
 * Warehouse CSV export in keyset pages of up to 1000 rows (rpc_get_warehouse_report_export):
 * - the first page fixes the server snapshot_at, every next page passes the same value;
 * - the cursor (next_after_id) must strictly increase — repeats / cycles abort the export;
 * - duplicate rows are dropped by id; one AbortController for the whole export;
 * - the CSV is built and downloaded only after the LAST page; any error, logout, loss of the admin
 *   role or unmount aborts the export and no partial file is ever created;
 * - a retry always starts a new export from the first page with a new snapshot_at.
 */
export const useWarehouseExport = ({
  userId,
  isAdmin,
  currentDateKey,
  download = downloadWarehouseExportCSV,
}: UseWarehouseExportOptions) => {
  const [state, setState] = useState<WarehouseExportState>(IDLE);
  const controllerRef = useRef<AbortController | null>(null);
  const isMountedRef = useRef<boolean>(true);
  const dateKeyRef = useRef(currentDateKey);
  const downloadRef = useRef(download);
  useEffect(() => {
    dateKeyRef.current = currentDateKey;
    downloadRef.current = download;
  }, [currentDateKey, download]);

  const enabled = Boolean(userId) && isAdmin;
  const resetKey = `${userId ?? ''}|${enabled ? 'admin' : 'none'}`;

  const [prevResetKey, setPrevResetKey] = useState(resetKey);
  if (prevResetKey !== resetKey) {
    setPrevResetKey(resetKey);
    setState(IDLE);
  }

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      controllerRef.current?.abort();
    };
  }, []);

  // Logout / user switch / loss of the admin role cancels a running export
  useEffect(() => {
    return () => {
      controllerRef.current?.abort();
      controllerRef.current = null;
    };
  }, [resetKey]);

  const startExport = useCallback(async () => {
    if (!enabled || controllerRef.current) return;

    const controller = new AbortController();
    controllerRef.current = controller;
    const isCurrent = () =>
      isMountedRef.current && !controller.signal.aborted && controllerRef.current === controller;
    const fail = (message: string) => {
      if (!isCurrent()) return;
      controllerRef.current = null;
      setState({ isExporting: false, exportedCount: 0, error: message });
      restoreLostFocus(EXPORT_RETRY_BUTTON_SELECTOR);
    };

    setState({ isExporting: true, exportedCount: 0, error: null });

    const rows: WarehouseExportRow[] = [];
    const seenIds = new Set<string>();
    const seenCursors = new Set<string>();
    let snapshotAt: string | null = null;
    let afterId: string | null = null;

    try {
      for (;;) {
        const res = await reportsApi.fetchWarehouseExportPage(
          { snapshotAt, afterId, limit: REPORTS_EXPORT_PAGE_SIZE },
          controller.signal
        );
        if (!isCurrent()) return;
        if (!res.success) {
          fail(`${res.error.message} Файл не создан.`);
          return;
        }

        const page = res.data;
        if (snapshotAt === null) {
          snapshotAt = page.snapshotAt;
        } else if (Date.parse(page.snapshotAt) !== Date.parse(snapshotAt)) {
          fail(INCONSISTENT_EXPORT);
          return;
        }

        for (const row of page.rows) {
          if (seenIds.has(row.id)) continue; // duplicate of an already received row: drop it
          // An unseen row at or before the cursor breaks the keyset order (possible gap): abort
          if (afterId !== null && !(row.id > afterId)) {
            fail(INCONSISTENT_EXPORT);
            return;
          }
          seenIds.add(row.id);
          rows.push(row);
        }
        setState({ isExporting: true, exportedCount: rows.length, error: null });

        if (page.nextAfterId === null) break;
        if (seenCursors.has(page.nextAfterId) || (afterId !== null && !(page.nextAfterId > afterId))) {
          fail(INCONSISTENT_EXPORT);
          return;
        }
        seenCursors.add(page.nextAfterId);
        afterId = page.nextAfterId;
      }
    } catch (err: unknown) {
      if ((err instanceof DOMException && err.name === 'AbortError') || !isCurrent()) return;
      fail('Ошибка сети при выгрузке склада. Файл не создан — повторите экспорт.');
      return;
    }

    if (!isCurrent()) return;
    controllerRef.current = null;
    // Only a complete export is ever turned into a file
    downloadRef.current(rows, dateKeyRef.current);
    setState({ isExporting: false, exportedCount: rows.length, error: null });
    restoreLostFocus(EXPORT_BUTTON_SELECTOR);
  }, [enabled]);

  const dismissError = useCallback(() => {
    setState((prev) => (prev.error ? IDLE : prev));
  }, []);

  return { ...state, startExport, dismissError };
};
