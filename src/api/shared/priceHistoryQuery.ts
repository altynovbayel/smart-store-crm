import { supabase } from '../../lib/supabase';
import type { PriceHistoryPoint } from '../../utils/outcomePriceHistory';

const BATCH_SIZE = 1000;

export type PriceHistoryQueryResult =
  | { success: true; rows: PriceHistoryPoint[] }
  | { success: false; error: unknown };

/**
 * Loads all product_price_history points for the given products in PostgREST-safe batches.
 * The returned error keeps the HTTP status for structural classification by the caller.
 */
export const fetchPriceHistoryPoints = async (
  productIds: readonly string[],
  signal?: AbortSignal
): Promise<PriceHistoryQueryResult> => {
  const allRows: PriceHistoryPoint[] = [];
  let from = 0;
  let hasMore = true;

  while (hasMore) {
    let query = supabase
      .from('product_price_history')
      .select('id, product_id, purchase_price_minor, effective_from, created_at')
      .in('product_id', [...productIds])
      .order('effective_from', { ascending: false })
      .order('id', { ascending: false })
      .range(from, from + BATCH_SIZE - 1);

    if (signal) {
      query = query.abortSignal(signal);
    }

    const { data, error, status } = await query;

    if (error) {
      return { success: false, error: { ...error, status } };
    }

    if (data && data.length > 0) {
      allRows.push(...data);
      if (data.length < BATCH_SIZE) {
        hasMore = false;
      } else {
        from += BATCH_SIZE;
      }
    } else {
      hasMore = false;
    }
  }

  return { success: true, rows: allRows };
};
