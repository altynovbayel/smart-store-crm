-- ============================================================================
-- Migration: RBAC step 4 — Dashboard and Reports RPCs as SECURITY DEFINER
-- Version: 20261020120000
-- Name: rbac_dashboard_reports_definer
-- Description:
--   Prepares the five read-only Dashboard / Reports RPCs for the planned
--   REVOKE SELECT on public.sales, public.sale_items and public.products. As SECURITY INVOKER
--   they read those tables with the caller's privileges and would fail with 42501 after the
--   REVOKE; as SECURITY DEFINER they read them with the owner's privileges.
--
--   Re-created with CREATE OR REPLACE (same signatures, defaults, return type, JSON contracts and
--   calculations). The bodies are the applied ones (20261018150000, 20261018180000) with ONLY:
--   1. SECURITY INVOKER → SECURITY DEFINER;
--   2. search_path pg_catalog, public, pg_temp → pg_catalog, pg_temp (every public object in the
--      bodies is already schema-qualified; nothing resolves through public any more);
--   3. Dashboard: built-in functions qualified with pg_catalog. (Reports already were), and the
--      role check expressed as an explicit matrix via private.current_user_role() — same
--      admitted set (any ACTIVE profile; app_role has only admin / cashier) and same message;
--   4. comments.
--
--   Role matrix (checked as the FIRST statement, before any table is read; the owner bypasses
--   RLS, so this check replaces the *_select_active_staff policies for these functions):
--   - rpc_get_dashboard_sales_summary, rpc_get_dashboard_stock_summary: active admin or cashier.
--     Their JSON never contains profit, cost or purchase prices (identical for both roles).
--   - rpc_get_sales_report, rpc_get_warehouse_report, rpc_get_warehouse_report_export: active
--     admin only (private.is_admin()); everyone else → 42501. These return gross profit and
--     purchase prices and must never become reachable by a cashier.
--   - anon: no EXECUTE (unchanged).
--
--   Not changed: table grants, RLS policies, other functions. Direct SELECT stays open until a
--   later migration; this migration alone does not protect any data.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. DASHBOARD: SALES SUMMARY (admin + cashier; no cost / profit / purchase price)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_get_dashboard_sales_summary(
  p_day_bounds timestamptz[],
  p_popular_limit integer DEFAULT 4,
  p_recent_limit integer DEFAULT 5
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_role public.app_role;
  v_bounds_count integer;
  v_from timestamptz;
  v_before timestamptz;
  v_daily jsonb;
  v_popular jsonb;
  v_recent jsonb;
BEGIN
  -- Role matrix (FIRST statement, before any data is read): active admin or cashier only.
  -- private.current_user_role() resolves auth.uid() + is_active; NULL for anon / inactive / missing.
  v_role := private.current_user_role();
  IF v_role IS NULL OR v_role NOT IN ('admin'::public.app_role, 'cashier'::public.app_role) THEN
    RAISE EXCEPTION 'Forbidden: User profile is not active or does not exist'
      USING ERRCODE = '42501';
  END IF;

  -- Input validation: 2..367 non-NULL, strictly increasing bounds of a one-dimensional array
  IF p_day_bounds IS NULL
     OR pg_catalog.array_ndims(p_day_bounds) IS DISTINCT FROM 1
     OR pg_catalog.array_lower(p_day_bounds, 1) IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'Validation error: Day bounds must be a non-empty one-dimensional array'
      USING ERRCODE = '22023';
  END IF;

  v_bounds_count := pg_catalog.cardinality(p_day_bounds);
  IF v_bounds_count < 2 OR v_bounds_count > 367 THEN
    RAISE EXCEPTION 'Validation error: Day bounds must contain between 2 and 367 values'
      USING ERRCODE = '22023';
  END IF;

  IF pg_catalog.array_position(p_day_bounds, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'Validation error: Day bounds must not contain NULL'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.generate_subscripts(p_day_bounds, 1) AS i
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
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
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
    FROM pg_catalog.generate_subscripts(p_day_bounds, 1) AS i
    WHERE i < v_bounds_count
  ) AS b
  CROSS JOIN LATERAL (
    SELECT
      COALESCE(pg_catalog.sum(s.total_minor), 0) AS revenue_minor,
      pg_catalog.count(s.id) AS receipts_count
    FROM public.sales AS s
    WHERE s.sold_at >= b.day_start
      AND s.sold_at < b.day_before
  ) AS agg;

  -- B. Popular products over the whole requested range; revenue = server-allocated net line totals
  SELECT COALESCE(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
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
        pg_catalog.sum(si.quantity) AS units,
        pg_catalog.sum(si.net_total_minor) AS revenue_minor,
        (pg_catalog.array_agg(si.product_name_snapshot ORDER BY s.sold_at DESC, s.created_at DESC, si.id DESC))[1]
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
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
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
      COALESCE(pg_catalog.sum(si.quantity), 0) AS units,
      pg_catalog.count(si.id) AS lines_count,
      (pg_catalog.array_agg(si.product_name_snapshot ORDER BY si.created_at ASC, si.id ASC))[1] AS first_name
    FROM public.sale_items AS si
    WHERE si.sale_id = recent.id
  ) AS lines;

  RETURN pg_catalog.jsonb_build_object(
    'daily_sales', v_daily,
    'popular_products', v_popular,
    'recent_sales', v_recent
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- 2. DASHBOARD: STOCK SUMMARY (admin + cashier; no purchase price)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_get_dashboard_stock_summary(
  p_low_stock_limit integer DEFAULT 8
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_role public.app_role;
  v_summary jsonb;
  v_low_stock jsonb;
BEGIN
  -- Role matrix (FIRST statement, before any data is read): active admin or cashier only.
  -- private.current_user_role() resolves auth.uid() + is_active; NULL for anon / inactive / missing.
  v_role := private.current_user_role();
  IF v_role IS NULL OR v_role NOT IN ('admin'::public.app_role, 'cashier'::public.app_role) THEN
    RAISE EXCEPTION 'Forbidden: User profile is not active or does not exist'
      USING ERRCODE = '42501';
  END IF;

  IF p_low_stock_limit IS NULL OR p_low_stock_limit < 1 OR p_low_stock_limit > 50 THEN
    RAISE EXCEPTION 'Validation error: Low stock limit must be between 1 and 50'
      USING ERRCODE = '22023';
  END IF;

  -- A. Totals over ALL active products (independent of any client catalog limit).
  -- Status rule mirrors calculateStockStatus: stock <= 0 → out_of_stock, stock <= threshold → low_stock
  SELECT pg_catalog.jsonb_build_object(
    'total_units', COALESCE(pg_catalog.sum(p.stock), 0)::text,
    'active_products_count', pg_catalog.count(*)::text,
    'problem_products_count',
      (pg_catalog.count(*) FILTER (WHERE p.stock <= 0 OR p.stock <= p.min_stock_threshold))::text
  )
  INTO v_summary
  FROM public.products AS p
  WHERE p.is_archived = false;

  -- B. Most critical active products: out of stock first, then low stock, then lowest stock
  SELECT COALESCE(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
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

  RETURN pg_catalog.jsonb_build_object(
    'stock_summary', v_summary,
    'low_stock_products', v_low_stock
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- 3. REPORTS: SALES REPORT (admin only; contains gross profit)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_get_sales_report(
  p_day_bounds timestamptz[],
  p_top_limit integer DEFAULT 5
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_bounds_count integer;
  v_from timestamptz;
  v_before timestamptz;
  v_summary jsonb;
  v_daily jsonb;
  v_payments jsonb;
  v_popular jsonb;
BEGIN
  -- Role matrix (FIRST statement, before any data is read): active admin only.
  IF NOT private.is_admin() THEN
    RAISE EXCEPTION 'Forbidden: Operation requires administrator privileges'
      USING ERRCODE = '42501';
  END IF;

  -- Input validation: one-dimensional, 1-based, 2..367 non-NULL strictly increasing bounds
  IF p_day_bounds IS NULL
     OR pg_catalog.array_ndims(p_day_bounds) IS DISTINCT FROM 1
     OR pg_catalog.array_lower(p_day_bounds, 1) IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'Validation error: Day bounds must be a non-empty one-dimensional array starting at index 1'
      USING ERRCODE = '22023';
  END IF;

  v_bounds_count := pg_catalog.cardinality(p_day_bounds);
  IF v_bounds_count < 2 OR v_bounds_count > 367 THEN
    RAISE EXCEPTION 'Validation error: Day bounds must contain between 2 and 367 values (1..366 days)'
      USING ERRCODE = '22023';
  END IF;

  IF pg_catalog.array_position(p_day_bounds, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'Validation error: Day bounds must not contain NULL'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.generate_subscripts(p_day_bounds, 1) AS i
    WHERE i > 1 AND p_day_bounds[i] <= p_day_bounds[i - 1]
  ) THEN
    RAISE EXCEPTION 'Validation error: Day bounds must be strictly increasing'
      USING ERRCODE = '22023';
  END IF;

  IF p_top_limit IS NULL OR p_top_limit < 1 OR p_top_limit > 50 THEN
    RAISE EXCEPTION 'Validation error: Top products limit must be between 1 and 50'
      USING ERRCODE = '22023';
  END IF;

  v_from := p_day_bounds[1];
  v_before := p_day_bounds[v_bounds_count];

  -- A. Summary, per-day series and payment methods in one pass over the period's receipts.
  --    width_bucket(sold_at, bounds) = i  ⇔  bound[i] <= sold_at < bound[i + 1]
  WITH period_sales AS (
    SELECT
      s.id,
      s.payment_method,
      s.total_minor,
      s.total_discount_minor,
      s.profit_minor,
      pg_catalog.width_bucket(s.sold_at, p_day_bounds) AS bucket
    FROM public.sales AS s
    WHERE s.sold_at >= v_from
      AND s.sold_at < v_before
  ),
  sale_units AS (
    SELECT si.sale_id, pg_catalog.sum(si.quantity) AS units
    FROM public.sale_items AS si
    JOIN period_sales AS ps ON ps.id = si.sale_id
    GROUP BY si.sale_id
  ),
  receipts AS (
    SELECT ps.*, COALESCE(su.units, 0) AS units
    FROM period_sales AS ps
    LEFT JOIN sale_units AS su ON su.sale_id = ps.id
  ),
  days AS (
    SELECT i AS bucket, p_day_bounds[i] AS day_start
    FROM pg_catalog.generate_subscripts(p_day_bounds, 1) AS i
    WHERE i < v_bounds_count
  ),
  daily_agg AS (
    SELECT
      r.bucket,
      pg_catalog.sum(r.total_minor) AS revenue_minor,
      pg_catalog.count(*) AS receipts_count,
      pg_catalog.sum(r.units) AS units_sold,
      pg_catalog.sum(r.total_discount_minor) AS total_discount_minor,
      pg_catalog.sum(r.total_minor) FILTER (WHERE r.payment_method = 'cash'::public.payment_method) AS cash_minor,
      pg_catalog.sum(r.total_minor) FILTER (WHERE r.payment_method = 'card'::public.payment_method) AS card_minor,
      pg_catalog.sum(r.total_minor) FILTER (WHERE r.payment_method = 'transfer'::public.payment_method) AS transfer_minor
    FROM receipts AS r
    GROUP BY r.bucket
  ),
  methods AS (
    SELECT m.method, m.ord
    FROM pg_catalog.unnest(
      ARRAY['cash', 'card', 'transfer']::public.payment_method[]
    ) WITH ORDINALITY AS m(method, ord)
  ),
  payment_agg AS (
    SELECT
      m.method,
      m.ord,
      COALESCE(pg_catalog.sum(r.total_minor), 0) AS amount_minor,
      pg_catalog.count(r.id) AS receipts_count
    FROM methods AS m
    LEFT JOIN receipts AS r ON r.payment_method = m.method
    GROUP BY m.method, m.ord
  )
  SELECT
    (
      SELECT pg_catalog.jsonb_build_object(
        'revenue_minor', COALESCE(pg_catalog.sum(r.total_minor), 0)::text,
        'receipts_count', pg_catalog.count(*)::text,
        'units_sold', COALESCE(pg_catalog.sum(r.units), 0)::text,
        'total_discount_minor', COALESCE(pg_catalog.sum(r.total_discount_minor), 0)::text,
        'gross_profit_minor', COALESCE(pg_catalog.sum(r.profit_minor), 0)::text
      )
      FROM receipts AS r
    ),
    (
      SELECT COALESCE(
        pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'day_start', d.day_start,
            'revenue_minor', COALESCE(a.revenue_minor, 0)::text,
            'receipts_count', COALESCE(a.receipts_count, 0)::text,
            'units_sold', COALESCE(a.units_sold, 0)::text,
            'total_discount_minor', COALESCE(a.total_discount_minor, 0)::text,
            'cash_minor', COALESCE(a.cash_minor, 0)::text,
            'card_minor', COALESCE(a.card_minor, 0)::text,
            'transfer_minor', COALESCE(a.transfer_minor, 0)::text
          )
          ORDER BY d.bucket
        ),
        '[]'::jsonb
      )
      FROM days AS d
      LEFT JOIN daily_agg AS a ON a.bucket = d.bucket
    ),
    (
      SELECT pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'method', p.method,
          'amount_minor', p.amount_minor::text,
          'receipts_count', p.receipts_count::text
        )
        ORDER BY p.ord
      )
      FROM payment_agg AS p
    )
  INTO v_summary, v_daily, v_payments;

  -- B. Popular products: units = Σ quantity, revenue = Σ net_total_minor (receipt discount already
  --    allocated by rpc_create_sale); name / SKU = latest snapshot of the product in the period.
  SELECT COALESCE(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'product_id', ranked.product_id,
        'name', ranked.name,
        'sku', ranked.sku,
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
      si.product_id,
      pg_catalog.sum(si.quantity) AS units,
      pg_catalog.sum(si.net_total_minor) AS revenue_minor,
      (pg_catalog.array_agg(si.product_name_snapshot ORDER BY s.sold_at DESC, s.created_at DESC, s.id DESC, si.id DESC))[1] AS name,
      (pg_catalog.array_agg(si.sku_snapshot ORDER BY s.sold_at DESC, s.created_at DESC, s.id DESC, si.id DESC))[1] AS sku
    FROM public.sale_items AS si
    JOIN public.sales AS s ON s.id = si.sale_id
    WHERE s.sold_at >= v_from
      AND s.sold_at < v_before
    GROUP BY si.product_id
    ORDER BY units DESC, revenue_minor DESC, si.product_id ASC
    LIMIT p_top_limit
  ) AS ranked;

  RETURN pg_catalog.jsonb_build_object(
    'summary', v_summary,
    'daily', v_daily,
    'payments', v_payments,
    'popular_products', v_popular
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- 4. REPORTS: WAREHOUSE REPORT (admin only; contains purchase prices)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_get_warehouse_report(
  p_attention_limit integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_summary jsonb;
  v_categories jsonb;
  v_statuses jsonb;
  v_attention jsonb;
BEGIN
  -- Role matrix (FIRST statement, before any data is read): active admin only.
  IF NOT private.is_admin() THEN
    RAISE EXCEPTION 'Forbidden: Operation requires administrator privileges'
      USING ERRCODE = '42501';
  END IF;

  IF p_attention_limit IS NULL OR p_attention_limit < 1 OR p_attention_limit > 200 THEN
    RAISE EXCEPTION 'Validation error: Attention products limit must be between 1 and 200'
      USING ERRCODE = '22023';
  END IF;

  -- Status rule mirrors calculateStockStatus: stock <= 0 → out_of_stock,
  -- stock <= min_stock_threshold → low_stock, otherwise in_stock. Archived products are excluded.

  -- A. Summary over ALL active products; price × stock in numeric (no bigint overflow)
  SELECT pg_catalog.jsonb_build_object(
    'active_positions_count', pg_catalog.count(*)::text,
    'total_units', COALESCE(pg_catalog.sum(p.stock), 0)::text,
    'purchase_value_minor',
      COALESCE(pg_catalog.sum(p.purchase_price_minor::numeric * p.stock::numeric), 0)::text,
    'potential_revenue_minor',
      COALESCE(pg_catalog.sum(p.selling_price_minor::numeric * p.stock::numeric), 0)::text,
    'potential_profit_minor',
      COALESCE(
        pg_catalog.sum((p.selling_price_minor::numeric - p.purchase_price_minor::numeric) * p.stock::numeric),
        0
      )::text,
    'attention_count',
      (pg_catalog.count(*) FILTER (WHERE p.stock <= 0 OR p.stock <= p.min_stock_threshold))::text
  )
  INTO v_summary
  FROM public.products AS p
  WHERE p.is_archived = false;

  -- B. Actual category groups (the client completes the 16 predefined categories with zeros)
  SELECT COALESCE(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'category', c.category,
        'positions_count', c.positions_count::text,
        'total_units', c.total_units::text,
        'purchase_value_minor', c.purchase_value_minor::text,
        'potential_revenue_minor', c.potential_revenue_minor::text
      )
      ORDER BY c.category
    ),
    '[]'::jsonb
  )
  INTO v_categories
  FROM (
    SELECT
      p.category,
      pg_catalog.count(*) AS positions_count,
      pg_catalog.sum(p.stock) AS total_units,
      pg_catalog.sum(p.purchase_price_minor::numeric * p.stock::numeric) AS purchase_value_minor,
      pg_catalog.sum(p.selling_price_minor::numeric * p.stock::numeric) AS potential_revenue_minor
    FROM public.products AS p
    WHERE p.is_archived = false
    GROUP BY p.category
  ) AS c;

  -- C. Stock status distribution
  SELECT pg_catalog.jsonb_build_object(
    'in_stock', (pg_catalog.count(*) FILTER (WHERE p.stock > 0 AND p.stock > p.min_stock_threshold))::text,
    'low_stock', (pg_catalog.count(*) FILTER (WHERE p.stock > 0 AND p.stock <= p.min_stock_threshold))::text,
    'out_of_stock', (pg_catalog.count(*) FILTER (WHERE p.stock <= 0))::text
  )
  INTO v_statuses
  FROM public.products AS p
  WHERE p.is_archived = false;

  -- D. Most critical products, same order as getAttentionProducts:
  --    zero stock first → stock / min_stock_threshold ASC (1 when threshold is 0) → name → id
  SELECT COALESCE(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'id', a.id,
        'name', a.name,
        'sku', a.sku,
        'category', a.category,
        'category_label', a.category_label,
        'stock', a.stock,
        'min_stock_threshold', a.min_stock_threshold,
        'purchase_price_minor', a.purchase_price_minor::text,
        'stock_purchase_value_minor', a.stock_purchase_value_minor::text,
        'status', a.status
      )
      ORDER BY a.zero_rank ASC, a.stock_ratio ASC, a.name ASC, a.id ASC
    ),
    '[]'::jsonb
  )
  INTO v_attention
  FROM (
    SELECT
      p.id,
      p.name,
      p.sku,
      p.category,
      p.category_label,
      p.stock,
      p.min_stock_threshold,
      p.purchase_price_minor,
      p.purchase_price_minor::numeric * p.stock::numeric AS stock_purchase_value_minor,
      CASE WHEN p.stock <= 0 THEN 'out_of_stock' ELSE 'low_stock' END AS status,
      CASE WHEN p.stock <= 0 THEN 0 ELSE 1 END AS zero_rank,
      CASE
        WHEN p.min_stock_threshold > 0 THEN p.stock::numeric / p.min_stock_threshold::numeric
        ELSE 1::numeric
      END AS stock_ratio
    FROM public.products AS p
    WHERE p.is_archived = false
      AND (p.stock <= 0 OR p.stock <= p.min_stock_threshold)
    ORDER BY zero_rank ASC, stock_ratio ASC, p.name ASC, p.id ASC
    LIMIT p_attention_limit
  ) AS a;

  RETURN pg_catalog.jsonb_build_object(
    'summary', v_summary,
    'categories', v_categories,
    'statuses', v_statuses,
    'attention', v_attention
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- 5. REPORTS: WAREHOUSE CSV EXPORT (admin only; contains purchase prices)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_get_warehouse_report_export(
  p_snapshot_at timestamptz DEFAULT NULL,
  p_after_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 1000
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_snapshot_at timestamptz;
  v_rows jsonb;
  v_count integer;
  v_last_id uuid;
BEGIN
  -- Role matrix (FIRST statement, before any data is read): active admin only.
  IF NOT private.is_admin() THEN
    RAISE EXCEPTION 'Forbidden: Operation requires administrator privileges'
      USING ERRCODE = '42501';
  END IF;

  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 1000 THEN
    RAISE EXCEPTION 'Validation error: Export page size must be between 1 and 1000'
      USING ERRCODE = '22023';
  END IF;

  IF p_after_id IS NOT NULL AND p_snapshot_at IS NULL THEN
    RAISE EXCEPTION 'Validation error: Continuation pages must pass the snapshot_at of the first page'
      USING ERRCODE = '22023';
  END IF;

  IF p_snapshot_at IS NOT NULL AND p_snapshot_at > pg_catalog.statement_timestamp() THEN
    RAISE EXCEPTION 'Validation error: snapshot_at cannot be in the future'
      USING ERRCODE = '22023';
  END IF;

  v_snapshot_at := COALESCE(p_snapshot_at, pg_catalog.statement_timestamp());

  SELECT
    COALESCE(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'id', page.id,
          'sku', page.sku,
          'barcode', page.barcode,
          'name', page.name,
          'category', page.category,
          'category_label', page.category_label,
          'purchase_price_minor', page.purchase_price_minor::text,
          'selling_price_minor', page.selling_price_minor::text,
          'stock', page.stock,
          'min_stock_threshold', page.min_stock_threshold,
          'purchase_value_minor', (page.purchase_price_minor::numeric * page.stock::numeric)::text,
          'potential_revenue_minor', (page.selling_price_minor::numeric * page.stock::numeric)::text,
          'status',
            CASE
              WHEN page.stock <= 0 THEN 'out_of_stock'
              WHEN page.stock <= page.min_stock_threshold THEN 'low_stock'
              ELSE 'in_stock'
            END
        )
        ORDER BY page.id
      ),
      '[]'::jsonb
    ),
    pg_catalog.count(*)::integer,
    (pg_catalog.array_agg(page.id ORDER BY page.id DESC))[1]
  INTO v_rows, v_count, v_last_id
  FROM (
    SELECT
      p.id,
      p.sku,
      p.barcode,
      p.name,
      p.category,
      p.category_label,
      p.purchase_price_minor,
      p.selling_price_minor,
      p.stock,
      p.min_stock_threshold
    FROM public.products AS p
    WHERE p.is_archived = false
      AND p.created_at <= v_snapshot_at
      AND (p_after_id IS NULL OR p.id > p_after_id)
    ORDER BY p.id ASC
    LIMIT p_limit
  ) AS page;

  RETURN pg_catalog.jsonb_build_object(
    'snapshot_at', v_snapshot_at,
    'rows', v_rows,
    -- A full page may be followed by one empty final page when the total is a multiple of p_limit
    'next_after_id', CASE WHEN v_count = p_limit THEN v_last_id ELSE NULL END
  );
END;
$$;

COMMENT ON FUNCTION public.rpc_get_dashboard_sales_summary(timestamptz[], integer, integer) IS
  'Read-only Dashboard sales aggregates (active admin / cashier; SECURITY DEFINER with role check first). No cost / purchase price / profit.';
COMMENT ON FUNCTION public.rpc_get_dashboard_stock_summary(integer) IS
  'Read-only Dashboard stock aggregates (active admin / cashier; SECURITY DEFINER with role check first). No purchase price.';
COMMENT ON FUNCTION public.rpc_get_sales_report(timestamptz[], integer) IS
  'Admin-only sales report (SECURITY DEFINER, private.is_admin() first): summary, per-day series, payment methods, popular products. Amounts as decimal text.';
COMMENT ON FUNCTION public.rpc_get_warehouse_report(integer) IS
  'Admin-only warehouse report (SECURITY DEFINER, private.is_admin() first) over all active products. Amounts as decimal text.';
COMMENT ON FUNCTION public.rpc_get_warehouse_report_export(timestamptz, uuid, integer) IS
  'Admin-only keyset-paginated warehouse CSV rows (SECURITY DEFINER, private.is_admin() first). Not a point-in-time snapshot across pages.';

-- ----------------------------------------------------------------------------
-- 6. PRIVILEGES: authenticated only (role enforced inside); restated explicitly
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.rpc_get_dashboard_sales_summary(timestamptz[], integer, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_get_dashboard_stock_summary(integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_get_sales_report(timestamptz[], integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_get_warehouse_report(integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_get_warehouse_report_export(timestamptz, uuid, integer) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.rpc_get_dashboard_sales_summary(timestamptz[], integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_get_dashboard_stock_summary(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_get_sales_report(timestamptz[], integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_get_warehouse_report(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_get_warehouse_report_export(timestamptz, uuid, integer) TO authenticated;

-- ============================================================================
-- End of Migration
-- ============================================================================
