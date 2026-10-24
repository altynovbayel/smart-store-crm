-- ============================================================================
-- Migration: Read-only Dashboard aggregation RPCs
-- Version: 20261018150000
-- Name: dashboard_summary_rpcs
-- Description:
--   Two read-only functions for the Dashboard (/), so that statistics stay exact for any
--   number of sales / products (no client-side 5000 receipt cap) and the Dashboard never
--   requests cost, purchase price or profit columns:
--
--   1. public.rpc_get_dashboard_sales_summary(p_day_bounds, p_popular_limit, p_recent_limit)
--      - daily_sales:      revenue and receipt count per [bound[i], bound[i+1]) interval (zeros included)
--      - popular_products: top products by units over [first bound, last bound) using net_total_minor
--      - recent_sales:     latest receipts (all time) with units, first line name and other lines count
--   2. public.rpc_get_dashboard_stock_summary(p_low_stock_limit)
--      - stock_summary:      units / active products / low + out of stock count (active products only)
--      - low_stock_products: most critical active products (no purchase price)
--
--   Security:
--   - SECURITY INVOKER: existing RLS policies (*_select_active_staff) still apply; no privilege
--     escalation. An explicit private.is_active_user() check turns an inactive profile into a
--     42501 error instead of silently empty statistics.
--   - STABLE, no writes; fixed search_path with pg_temp last; fully qualified object names.
--   - EXECUTE revoked from PUBLIC / anon, granted to authenticated only.
--   - Aggregated minor-unit sums and counters are returned as TEXT (exact; parsed with BigInt
--     on the client). Calendar day bounds are local midnights computed by the client.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. SALES SUMMARY
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_get_dashboard_sales_summary(
  p_day_bounds timestamptz[],
  p_popular_limit integer DEFAULT 4,
  p_recent_limit integer DEFAULT 5
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_bounds_count integer;
  v_from timestamptz;
  v_before timestamptz;
  v_daily jsonb;
  v_popular jsonb;
  v_recent jsonb;
BEGIN
  IF NOT private.is_active_user() THEN
    RAISE EXCEPTION 'Forbidden: User profile is not active or does not exist'
      USING ERRCODE = '42501';
  END IF;

  -- Input validation: 2..367 non-NULL, strictly increasing bounds of a one-dimensional array
  IF p_day_bounds IS NULL
     OR array_ndims(p_day_bounds) IS DISTINCT FROM 1
     OR array_lower(p_day_bounds, 1) IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'Validation error: Day bounds must be a non-empty one-dimensional array'
      USING ERRCODE = '22023';
  END IF;

  v_bounds_count := cardinality(p_day_bounds);
  IF v_bounds_count < 2 OR v_bounds_count > 367 THEN
    RAISE EXCEPTION 'Validation error: Day bounds must contain between 2 and 367 values'
      USING ERRCODE = '22023';
  END IF;

  IF array_position(p_day_bounds, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'Validation error: Day bounds must not contain NULL'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM generate_subscripts(p_day_bounds, 1) AS i
    WHERE i > 1 AND p_day_bounds[i] <= p_day_bounds[i - 1]
  ) THEN
    RAISE EXCEPTION 'Validation error: Day bounds must be strictly increasing'
      USING ERRCODE = '22023';
  END IF;

  IF p_popular_limit IS NULL OR p_popular_limit < 1 OR p_popular_limit > 50 THEN
    RAISE EXCEPTION 'Validation error: Popular products limit must be between 1 and 50'
      USING ERRCODE = '22023';
  END IF;

  IF p_recent_limit IS NULL OR p_recent_limit < 1 OR p_recent_limit > 50 THEN
    RAISE EXCEPTION 'Validation error: Recent sales limit must be between 1 and 50'
      USING ERRCODE = '22023';
  END IF;

  v_from := p_day_bounds[1];
  v_before := p_day_bounds[v_bounds_count];

  -- A. Revenue and receipts per interval [bound[i], bound[i + 1]); days without sales return zeros
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'day_start', b.day_start,
        'revenue_minor', agg.revenue_minor::text,
        'receipts_count', agg.receipts_count::text
      )
      ORDER BY b.idx
    ),
    '[]'::jsonb
  )
  INTO v_daily
  FROM (
    SELECT i AS idx, p_day_bounds[i] AS day_start, p_day_bounds[i + 1] AS day_before
    FROM generate_subscripts(p_day_bounds, 1) AS i
    WHERE i < v_bounds_count
  ) AS b
  CROSS JOIN LATERAL (
    SELECT
      COALESCE(sum(s.total_minor), 0) AS revenue_minor,
      count(s.id) AS receipts_count
    FROM public.sales AS s
    WHERE s.sold_at >= b.day_start
      AND s.sold_at < b.day_before
  ) AS agg;

  -- B. Popular products over the whole requested range; revenue = server-allocated net line totals
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'product_id', ranked.product_id,
        'name', ranked.name,
        'category', ranked.category,
        'category_label', ranked.category_label,
        'units', ranked.units::text,
        'revenue_minor', ranked.revenue_minor::text
      )
      ORDER BY ranked.units DESC, ranked.revenue_minor DESC, ranked.product_id ASC
    ),
    '[]'::jsonb
  )
  INTO v_popular
  FROM (
    SELECT
      line.product_id,
      COALESCE(p.name, line.latest_name_snapshot) AS name,
      COALESCE(p.category, 'other') AS category,
      COALESCE(p.category_label, 'Другое') AS category_label,
      line.units,
      line.revenue_minor
    FROM (
      SELECT
        si.product_id,
        sum(si.quantity) AS units,
        sum(si.net_total_minor) AS revenue_minor,
        (array_agg(si.product_name_snapshot ORDER BY s.sold_at DESC, s.created_at DESC, si.id DESC))[1]
          AS latest_name_snapshot
      FROM public.sale_items AS si
      JOIN public.sales AS s ON s.id = si.sale_id
      WHERE s.sold_at >= v_from
        AND s.sold_at < v_before
      GROUP BY si.product_id
    ) AS line
    -- Archived products are intentionally included: their real name / category stay visible
    LEFT JOIN public.products AS p ON p.id = line.product_id
    ORDER BY line.units DESC, line.revenue_minor DESC, line.product_id ASC
    LIMIT p_popular_limit
  ) AS ranked;

  -- C. Latest receipts of all time (no cost / profit); first line uses the receipt line order
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', recent.id,
        'receipt_number', recent.receipt_number,
        'sold_at', recent.sold_at,
        'payment_method', recent.payment_method,
        'status', recent.status,
        'total_minor', recent.total_minor::text,
        'items_count', lines.units::text,
        'lines_count', lines.lines_count::text,
        'primary_product_name', lines.first_name
      )
      ORDER BY recent.sold_at DESC, recent.created_at DESC, recent.id DESC
    ),
    '[]'::jsonb
  )
  INTO v_recent
  FROM (
    SELECT s.id, s.receipt_number, s.sold_at, s.created_at, s.payment_method, s.status, s.total_minor
    FROM public.sales AS s
    ORDER BY s.sold_at DESC, s.created_at DESC, s.id DESC
    LIMIT p_recent_limit
  ) AS recent
  CROSS JOIN LATERAL (
    SELECT
      COALESCE(sum(si.quantity), 0) AS units,
      count(si.id) AS lines_count,
      (array_agg(si.product_name_snapshot ORDER BY si.created_at ASC, si.id ASC))[1] AS first_name
    FROM public.sale_items AS si
    WHERE si.sale_id = recent.id
  ) AS lines;

  RETURN jsonb_build_object(
    'daily_sales', v_daily,
    'popular_products', v_popular,
    'recent_sales', v_recent
  );
END;
$$;

COMMENT ON FUNCTION public.rpc_get_dashboard_sales_summary(timestamptz[], integer, integer) IS
  'Read-only Dashboard sales aggregates (revenue per local day, top products by units, latest receipts). No cost / purchase price / profit.';

-- ----------------------------------------------------------------------------
-- 2. STOCK SUMMARY
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_get_dashboard_stock_summary(
  p_low_stock_limit integer DEFAULT 8
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_summary jsonb;
  v_low_stock jsonb;
BEGIN
  IF NOT private.is_active_user() THEN
    RAISE EXCEPTION 'Forbidden: User profile is not active or does not exist'
      USING ERRCODE = '42501';
  END IF;

  IF p_low_stock_limit IS NULL OR p_low_stock_limit < 1 OR p_low_stock_limit > 50 THEN
    RAISE EXCEPTION 'Validation error: Low stock limit must be between 1 and 50'
      USING ERRCODE = '22023';
  END IF;

  -- A. Totals over ALL active products (independent of any client catalog limit).
  -- Status rule mirrors calculateStockStatus: stock <= 0 → out_of_stock, stock <= threshold → low_stock
  SELECT jsonb_build_object(
    'total_units', COALESCE(sum(p.stock), 0)::text,
    'active_products_count', count(*)::text,
    'problem_products_count',
      (count(*) FILTER (WHERE p.stock <= 0 OR p.stock <= p.min_stock_threshold))::text
  )
  INTO v_summary
  FROM public.products AS p
  WHERE p.is_archived = false;

  -- B. Most critical active products: out of stock first, then low stock, then lowest stock
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', critical.id,
        'sku', critical.sku,
        'name', critical.name,
        'category', critical.category,
        'category_label', critical.category_label,
        'stock', critical.stock,
        'min_stock_threshold', critical.min_stock_threshold,
        'status', critical.status
      )
      ORDER BY critical.status_rank ASC, critical.stock ASC, critical.name ASC, critical.id ASC
    ),
    '[]'::jsonb
  )
  INTO v_low_stock
  FROM (
    SELECT
      p.id,
      p.sku,
      p.name,
      p.category,
      p.category_label,
      p.stock,
      p.min_stock_threshold,
      CASE WHEN p.stock <= 0 THEN 'out_of_stock' ELSE 'low_stock' END AS status,
      CASE WHEN p.stock <= 0 THEN 0 ELSE 1 END AS status_rank
    FROM public.products AS p
    WHERE p.is_archived = false
      AND (p.stock <= 0 OR p.stock <= p.min_stock_threshold)
    ORDER BY status_rank ASC, p.stock ASC, p.name ASC, p.id ASC
    LIMIT p_low_stock_limit
  ) AS critical;

  RETURN jsonb_build_object(
    'stock_summary', v_summary,
    'low_stock_products', v_low_stock
  );
END;
$$;

COMMENT ON FUNCTION public.rpc_get_dashboard_stock_summary(integer) IS
  'Read-only Dashboard stock aggregates over active products and the most critical low-stock items. No purchase price.';

-- ----------------------------------------------------------------------------
-- 3. PRIVILEGES: authenticated only
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.rpc_get_dashboard_sales_summary(timestamptz[], integer, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_get_dashboard_stock_summary(integer) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.rpc_get_dashboard_sales_summary(timestamptz[], integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_get_dashboard_stock_summary(integer) TO authenticated;

-- ============================================================================
-- End of Migration
-- ============================================================================
