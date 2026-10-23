-- ============================================================================
-- Migration: RBAC step 3 — role-aware read-only RPCs for sales receipts
-- Version: 20261020100000
-- Name: rbac_sales_read_rpcs
-- Description:
--   Additive step of the RBAC hardening plan. Adds read-only RPCs that return receipts with
--   their lines WITHOUT cost data for cashiers, so that a later migration can revoke direct
--   SELECT on public.sales / public.sale_items without breaking the Sales / Sales History pages:
--
--   1. public.rpc_list_sales(p_sold_from, p_sold_before, p_after_sold_at, p_after_created_at,
--                            p_after_id, p_limit)     — keyset pages of receipts + lines
--   2. public.rpc_get_sale(p_sale_id)                  — one receipt (pending-sale recovery)
--   3. public.rpc_has_any_sales()                      — "are there any sales at all" probe
--                                                         (Sales History empty-state)
--   4. public.rpc_create_sale — CREATE OR REPLACE with the IDENTICAL body except the two
--      RETURN statements: profit_minor is removed from the response for non-admin callers
--      (new sale AND idempotent replay). Calculations, locking, idempotency, signature,
--      search_path, owner and grants are unchanged.
--
--   Tables, grants and RLS policies are NOT changed (direct SELECT stays open until the
--   frontend is migrated; this migration alone does not protect cost data).
--
--   Field contract (explicit lists, no SELECT * / row_to_json of rows):
--   receipt (both roles): id, receipt_number, sold_at, created_at, payment_method, status,
--     subtotal_minor, item_discount_total_minor, receipt_discount_type, receipt_discount_value,
--     receipt_discount_minor, total_discount_minor, total_minor, received_minor, change_minor,
--     comment, created_by_name, items
--   receipt (admin only): profit_minor
--   line (both roles): id, product_id, product_name_snapshot, sku_snapshot, barcode_snapshot,
--     quantity, selling_price_snapshot_minor, discount_type, discount_value, gross_minor,
--     item_discount_minor, receipt_discount_allocated_minor, net_total_minor, created_at
--   line (admin only): purchase_price_snapshot_minor, cost_total_minor, profit_minor
--   Never returned: sales.created_by (internal profile id), sale_items.sale_id (implicit).
--
--   Security:
--   - Public RPCs are SECURITY DEFINER (they must keep working after REVOKE SELECT). The FIRST
--     statement resolves the caller with private.current_user_role() (auth.uid(), is_active):
--     anonymous / inactive / unknown → 42501 before any data is read. The include-cost flag is
--     derived ONLY from that server-side role, never from an argument.
--   - The shared builder private.sales_page_rows() is SECURITY INVOKER and NOT executable by
--     PUBLIC / anon / authenticated; it is only called from the definer RPCs above.
--   - STABLE, no writes, no dynamic SQL; search_path = pg_catalog, public, pg_temp; every
--     object schema-qualified. Errors carry fixed messages only (no data).
--   - EXECUTE on the new public RPCs: revoked from PUBLIC / anon, granted to authenticated.
--
--   Pagination (rpc_list_sales): keyset on (sold_at, created_at, id) DESC — the order used by
--   salesApi today. All three columns are immutable (no UPDATE on sales), the id makes the
--   order total even for identical timestamps. next_cursor is returned only for a FULL page,
--   so an exact multiple of p_limit ends with one empty page. Cursor values are passed back
--   unchanged (microsecond timestamptz strings). A receipt inserted later with an older
--   sold_at (back-dated sale) may appear on a later page or after a reload.
--   p_limit 1..200 receipts (each with all its lines; lines per receipt are bounded by the
--   UNIQUE (sale_id, product_id) constraint).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. SHARED PAGE BUILDER (internal, not executable by clients)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.sales_page_rows(
  p_include_cost boolean,
  p_sale_id uuid,
  p_sold_from timestamptz,
  p_sold_before timestamptz,
  p_after_sold_at timestamptz,
  p_after_created_at timestamptz,
  p_after_id uuid,
  p_limit integer
)
RETURNS TABLE (
  rows jsonb,
  row_count integer,
  last_sold_at timestamptz,
  last_created_at timestamptz,
  last_id uuid
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT
    COALESCE(
      pg_catalog.jsonb_agg(
        CASE
          WHEN p_include_cost IS TRUE THEN
            pg_catalog.jsonb_build_object(
              'id', page.id,
              'receipt_number', page.receipt_number,
              'sold_at', page.sold_at,
              'created_at', page.created_at,
              'payment_method', page.payment_method,
              'status', page.status,
              'subtotal_minor', page.subtotal_minor,
              'item_discount_total_minor', page.item_discount_total_minor,
              'receipt_discount_type', page.receipt_discount_type,
              'receipt_discount_value', page.receipt_discount_value,
              'receipt_discount_minor', page.receipt_discount_minor,
              'total_discount_minor', page.total_discount_minor,
              'total_minor', page.total_minor,
              'received_minor', page.received_minor,
              'change_minor', page.change_minor,
              'comment', page.comment,
              'created_by_name', page.created_by_name,
              'profit_minor', page.profit_minor,
              'items', page.items
            )
          ELSE
            pg_catalog.jsonb_build_object(
              'id', page.id,
              'receipt_number', page.receipt_number,
              'sold_at', page.sold_at,
              'created_at', page.created_at,
              'payment_method', page.payment_method,
              'status', page.status,
              'subtotal_minor', page.subtotal_minor,
              'item_discount_total_minor', page.item_discount_total_minor,
              'receipt_discount_type', page.receipt_discount_type,
              'receipt_discount_value', page.receipt_discount_value,
              'receipt_discount_minor', page.receipt_discount_minor,
              'total_discount_minor', page.total_discount_minor,
              'total_minor', page.total_minor,
              'received_minor', page.received_minor,
              'change_minor', page.change_minor,
              'comment', page.comment,
              'created_by_name', page.created_by_name,
              'items', page.items
            )
        END
        ORDER BY page.sold_at DESC, page.created_at DESC, page.id DESC
      ),
      '[]'::jsonb
    ),
    pg_catalog.count(*)::integer,
    -- Cursor = last row of the page in the DESC order (= first in ASC order)
    (pg_catalog.array_agg(page.sold_at ORDER BY page.sold_at ASC, page.created_at ASC, page.id ASC))[1],
    (pg_catalog.array_agg(page.created_at ORDER BY page.sold_at ASC, page.created_at ASC, page.id ASC))[1],
    (pg_catalog.array_agg(page.id ORDER BY page.sold_at ASC, page.created_at ASC, page.id ASC))[1]
  FROM (
    SELECT
      s.id,
      s.receipt_number,
      s.sold_at,
      s.created_at,
      s.payment_method,
      s.status,
      s.subtotal_minor,
      s.item_discount_total_minor,
      s.receipt_discount_type,
      s.receipt_discount_value,
      s.receipt_discount_minor,
      s.total_discount_minor,
      s.total_minor,
      s.received_minor,
      s.change_minor,
      s.comment,
      s.created_by_name,
      s.profit_minor,
      (
        SELECT
          COALESCE(
            pg_catalog.jsonb_agg(
              CASE
                WHEN p_include_cost IS TRUE THEN
                  pg_catalog.jsonb_build_object(
                    'id', i.id,
                    'product_id', i.product_id,
                    'product_name_snapshot', i.product_name_snapshot,
                    'sku_snapshot', i.sku_snapshot,
                    'barcode_snapshot', i.barcode_snapshot,
                    'quantity', i.quantity,
                    'selling_price_snapshot_minor', i.selling_price_snapshot_minor,
                    'discount_type', i.discount_type,
                    'discount_value', i.discount_value,
                    'gross_minor', i.gross_minor,
                    'item_discount_minor', i.item_discount_minor,
                    'receipt_discount_allocated_minor', i.receipt_discount_allocated_minor,
                    'net_total_minor', i.net_total_minor,
                    'created_at', i.created_at,
                    'purchase_price_snapshot_minor', i.purchase_price_snapshot_minor,
                    'cost_total_minor', i.cost_total_minor,
                    'profit_minor', i.profit_minor
                  )
                ELSE
                  pg_catalog.jsonb_build_object(
                    'id', i.id,
                    'product_id', i.product_id,
                    'product_name_snapshot', i.product_name_snapshot,
                    'sku_snapshot', i.sku_snapshot,
                    'barcode_snapshot', i.barcode_snapshot,
                    'quantity', i.quantity,
                    'selling_price_snapshot_minor', i.selling_price_snapshot_minor,
                    'discount_type', i.discount_type,
                    'discount_value', i.discount_value,
                    'gross_minor', i.gross_minor,
                    'item_discount_minor', i.item_discount_minor,
                    'receipt_discount_allocated_minor', i.receipt_discount_allocated_minor,
                    'net_total_minor', i.net_total_minor,
                    'created_at', i.created_at
                  )
              END
              ORDER BY i.created_at ASC, i.id ASC
            ),
            '[]'::jsonb
          )
        FROM public.sale_items AS i
        WHERE i.sale_id = s.id
      ) AS items
    FROM public.sales AS s
    WHERE (p_sale_id IS NULL OR s.id = p_sale_id)
      AND (p_sold_from IS NULL OR s.sold_at >= p_sold_from)
      AND (p_sold_before IS NULL OR s.sold_at < p_sold_before)
      AND (
        p_after_id IS NULL
        OR (s.sold_at, s.created_at, s.id) < (p_after_sold_at, p_after_created_at, p_after_id)
      )
    ORDER BY s.sold_at DESC, s.created_at DESC, s.id DESC
    LIMIT p_limit
  ) AS page;
$$;

COMMENT ON FUNCTION private.sales_page_rows(boolean, uuid, timestamptz, timestamptz, timestamptz, timestamptz, uuid, integer) IS
  'Internal: receipts + lines as JSON with explicit field lists (cost fields only when p_include_cost). Called only by the role-checking sales RPCs.';

-- ----------------------------------------------------------------------------
-- 2. RECEIPT LIST (Sales page, Sales History)
-- ----------------------------------------------------------------------------
-- JSON contract:
--   { "role": "admin" | "cashier",
--     "rows": [ <receipt> ... ],     -- sold_at DESC, created_at DESC, id DESC; <= p_limit
--     "next_cursor": { "sold_at": timestamptz, "created_at": timestamptz, "id": uuid } | null }
--   Range: sold_at >= p_sold_from (inclusive) AND sold_at < p_sold_before (exclusive), each optional.
CREATE OR REPLACE FUNCTION public.rpc_list_sales(
  p_sold_from timestamptz DEFAULT NULL,
  p_sold_before timestamptz DEFAULT NULL,
  p_after_sold_at timestamptz DEFAULT NULL,
  p_after_created_at timestamptz DEFAULT NULL,
  p_after_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 200
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_role public.app_role;
  v_has_cursor boolean;
  v_rows jsonb;
  v_count integer;
  v_last_sold_at timestamptz;
  v_last_created_at timestamptz;
  v_last_id uuid;
BEGIN
  -- Active profile (role + is_active) of auth.uid(); NULL for anonymous / inactive / missing
  v_role := private.current_user_role();
  IF v_role IS NULL OR v_role NOT IN ('admin'::public.app_role, 'cashier'::public.app_role) THEN
    RAISE EXCEPTION 'Forbidden: User profile is not active or does not exist'
      USING ERRCODE = '42501';
  END IF;

  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 200 THEN
    RAISE EXCEPTION 'Validation error: Page size must be between 1 and 200'
      USING ERRCODE = '22023';
  END IF;

  IF p_sold_from IS NOT NULL AND p_sold_before IS NOT NULL AND p_sold_from >= p_sold_before THEN
    RAISE EXCEPTION 'Validation error: Sale range start must be before its end'
      USING ERRCODE = '22023';
  END IF;

  -- Cursor must be complete (all three values) or absent
  v_has_cursor := p_after_sold_at IS NOT NULL;
  IF (p_after_created_at IS NOT NULL) IS DISTINCT FROM v_has_cursor
     OR (p_after_id IS NOT NULL) IS DISTINCT FROM v_has_cursor THEN
    RAISE EXCEPTION 'Validation error: Cursor must contain sold_at, created_at and id together'
      USING ERRCODE = '22023';
  END IF;

  SELECT pr.rows, pr.row_count, pr.last_sold_at, pr.last_created_at, pr.last_id
  INTO v_rows, v_count, v_last_sold_at, v_last_created_at, v_last_id
  FROM private.sales_page_rows(
    v_role = 'admin'::public.app_role,
    NULL,
    p_sold_from,
    p_sold_before,
    p_after_sold_at,
    p_after_created_at,
    p_after_id,
    p_limit
  ) AS pr;

  RETURN pg_catalog.jsonb_build_object(
    'role', v_role,
    'rows', v_rows,
    'next_cursor',
      CASE
        WHEN v_count = p_limit THEN
          pg_catalog.jsonb_build_object(
            'sold_at', v_last_sold_at,
            'created_at', v_last_created_at,
            'id', v_last_id
          )
        ELSE NULL
      END
  );
END;
$$;

COMMENT ON FUNCTION public.rpc_list_sales(timestamptz, timestamptz, timestamptz, timestamptz, uuid, integer) IS
  'Role-aware receipt page with lines (keyset on sold_at, created_at, id DESC; <= 200 receipts). Cashier JSON omits profit_minor, cost_total_minor and purchase_price_snapshot_minor.';

-- ----------------------------------------------------------------------------
-- 3. ONE RECEIPT (pending / unconfirmed sale recovery)
-- ----------------------------------------------------------------------------
-- JSON contract: { "role": "admin" | "cashier", "sale": <receipt> | null }
CREATE OR REPLACE FUNCTION public.rpc_get_sale(
  p_sale_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_role public.app_role;
  v_rows jsonb;
  v_count integer;
BEGIN
  v_role := private.current_user_role();
  IF v_role IS NULL OR v_role NOT IN ('admin'::public.app_role, 'cashier'::public.app_role) THEN
    RAISE EXCEPTION 'Forbidden: User profile is not active or does not exist'
      USING ERRCODE = '42501';
  END IF;

  IF p_sale_id IS NULL THEN
    RAISE EXCEPTION 'Validation error: Sale id is required'
      USING ERRCODE = '22023';
  END IF;

  SELECT pr.rows, pr.row_count
  INTO v_rows, v_count
  FROM private.sales_page_rows(
    v_role = 'admin'::public.app_role,
    p_sale_id,
    NULL, NULL, NULL, NULL, NULL,
    1
  ) AS pr;

  RETURN pg_catalog.jsonb_build_object(
    'role', v_role,
    'sale', CASE WHEN v_count = 1 THEN v_rows -> 0 ELSE NULL END
  );
END;
$$;

COMMENT ON FUNCTION public.rpc_get_sale(uuid) IS
  'Role-aware single receipt with lines, or sale = null when it does not exist. Cashier JSON omits cost fields.';

-- ----------------------------------------------------------------------------
-- 4. EXISTENCE PROBE (Sales History: "no sales at all" vs "nothing in this period")
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_has_any_sales()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_role public.app_role;
BEGIN
  v_role := private.current_user_role();
  IF v_role IS NULL OR v_role NOT IN ('admin'::public.app_role, 'cashier'::public.app_role) THEN
    RAISE EXCEPTION 'Forbidden: User profile is not active or does not exist'
      USING ERRCODE = '42501';
  END IF;

  RETURN EXISTS (SELECT 1 FROM public.sales AS s);
END;
$$;

COMMENT ON FUNCTION public.rpc_has_any_sales() IS
  'True when at least one receipt exists (active staff only). Returns no receipt data.';

-- ----------------------------------------------------------------------------
-- 5. rpc_create_sale: no profit_minor in the response for non-admin callers
-- ----------------------------------------------------------------------------
-- The body below is a VERBATIM copy of the applied definition
-- (20261009120000_atomic_business_rpc_functions.sql, section 6; not modified by later migrations)
-- with exactly two changes: each of the two RETURN statements (idempotent replay and new sale)
-- removes the key 'profit_minor' from its jsonb result when v_profile.role is not admin.
-- v_profile is resolved by private.get_active_profile(false) as the FIRST statement, i.e. before
-- both RETURNs. Signature, defaults, SECURITY DEFINER, search_path, calculations, advisory lock,
-- idempotency and all side effects are unchanged; CREATE OR REPLACE keeps owner and grants.
CREATE OR REPLACE FUNCTION public.rpc_create_sale(
  p_payment_method public.payment_method,
  p_receipt_discount_type public.discount_type DEFAULT 'none',
  p_receipt_discount_value bigint DEFAULT 0,
  p_received_minor bigint DEFAULT NULL,
  p_sold_at timestamptz DEFAULT now(),
  p_comment text DEFAULT NULL,
  p_items jsonb DEFAULT '[]'::jsonb,
  p_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private, pg_temp
AS $$
DECLARE
  v_profile RECORD;
  v_existing RECORD;
  v_comment text;
  v_sold_at timestamptz;
  v_sale_id uuid;
  v_receipt_number text;
  v_seq_val bigint;
  v_year text;
  v_item_count integer;

  -- Totals
  v_subtotal_minor bigint := 0;
  v_item_discount_total_minor bigint := 0;
  v_eligible_subtotal_minor bigint := 0;
  v_receipt_discount_minor bigint := 0;
  v_total_discount_minor bigint := 0;
  v_total_minor bigint := 0;
  v_total_cost_minor bigint := 0;
  v_profit_minor bigint := 0;
  v_received_minor bigint := NULL;
  v_change_minor bigint := NULL;

  -- Array of product IDs for locking
  v_product_ids uuid[];
  v_product_map jsonb := '{}'::jsonb;
  v_product RECORD;

  -- Iteration and line item variables
  v_item jsonb;
  v_prod_id uuid;
  v_qty integer;
  v_unit_price_minor bigint;
  v_cost_price_minor bigint;
  v_historical_cost_minor bigint;
  v_item_disc_type public.discount_type;
  v_item_disc_val bigint;
  v_line_gross_minor bigint;
  v_line_cost_minor bigint;
  v_line_item_disc_minor bigint;
  v_line_final_before_receipt_disc bigint;
  v_line_net_total_minor bigint;
  v_line_profit_minor bigint;
  v_allocated_receipt_disc bigint;
  v_new_stock integer;

  -- Array for processed items
  v_processed_items jsonb := '[]'::jsonb;
  v_allocated_sum bigint := 0;
  v_remainder bigint := 0;
  v_allocations bigint[];
  v_headrooms bigint[];
  v_idx integer := 0;

  -- Chronology variables
  v_min_future_balance integer;
  v_future_delta_sum integer;
  v_historical_balance_before integer;
  v_historical_balance_after integer;
BEGIN
  -- 1. Security check: active staff member (cashier or admin)
  SELECT * INTO v_profile FROM private.get_active_profile(false);

  -- 2. Idempotency check: if p_id is provided, serialize and check if it already exists
  IF p_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext(p_id::text));

    SELECT s.id, s.receipt_number, s.total_minor, s.profit_minor, s.change_minor, (SELECT count(*) FROM public.sale_items WHERE sale_id = s.id)::integer AS items_count
    INTO v_existing
    FROM public.sales s
    WHERE s.id = p_id;

    IF v_existing.id IS NOT NULL THEN
      RETURN json_build_object(
        'id', v_existing.id,
        'receipt_number', v_existing.receipt_number,
        'total_minor', v_existing.total_minor,
        'profit_minor', v_existing.profit_minor,
        'change_minor', v_existing.change_minor,
        'items_count', v_existing.items_count
      )::jsonb
        -- RBAC: profit_minor is returned to admins only (replay of an existing receipt)
        - CASE WHEN v_profile.role = 'admin'::public.app_role THEN ARRAY[]::text[] ELSE ARRAY['profit_minor']::text[] END;
    END IF;
  END IF;

  -- 3. Validate input arguments
  v_sold_at := COALESCE(p_sold_at, clock_timestamp());
  IF v_sold_at > clock_timestamp() THEN
    RAISE EXCEPTION 'Validation error: Sale date cannot be in the future' USING ERRCODE = '22023';
  END IF;

  v_comment := NULLIF(trim(p_comment), '');

  IF p_items IS NULL OR jsonb_typeof(p_items) != 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Validation error: Sale must contain at least one line item in a JSON array' USING ERRCODE = '22023';
  END IF;

  v_item_count := jsonb_array_length(p_items);

  IF p_payment_method IS NULL THEN
    RAISE EXCEPTION 'Validation error: Payment method is required' USING ERRCODE = '22023';
  END IF;

  IF p_receipt_discount_value < 0 OR p_receipt_discount_value > 9007199254740991 THEN
    RAISE EXCEPTION 'Validation error: Receipt discount value is out of safe bounds (0..9007199254740991)' USING ERRCODE = '22003';
  END IF;
  IF p_receipt_discount_type = 'percent'::public.discount_type AND p_receipt_discount_value > 10000 THEN
    RAISE EXCEPTION 'Validation error: Receipt percent discount cannot exceed 100.00%% (10000 bps)' USING ERRCODE = '22003';
  END IF;

  -- 4. Extract and check product IDs for duplicates
  SELECT array_agg(DISTINCT (item->>'product_id')::uuid)
  INTO v_product_ids
  FROM jsonb_array_elements(p_items) AS item;

  IF array_length(v_product_ids, 1) != v_item_count THEN
    RAISE EXCEPTION 'Validation error: Duplicate product in sale items' USING ERRCODE = '22023';
  END IF;

  -- 5. Lock affected products in deterministic ascending order to prevent deadlocks
  FOR v_product IN
    SELECT p.id, p.name, p.sku, p.barcode, p.stock, p.purchase_price_minor, p.selling_price_minor, p.is_archived
    FROM public.products p
    WHERE p.id = ANY(v_product_ids)
    ORDER BY p.id ASC
    FOR UPDATE
  LOOP
    IF v_product.is_archived THEN
      RAISE EXCEPTION 'Validation error: Cannot sell archived product "%"', v_product.name USING ERRCODE = '22023';
    END IF;
    v_product_map := jsonb_set(
      v_product_map,
      ARRAY[v_product.id::text],
      json_build_object(
        'name', v_product.name,
        'sku', v_product.sku,
        'barcode', v_product.barcode,
        'stock', v_product.stock,
        'purchase_price_minor', v_product.purchase_price_minor,
        'selling_price_minor', v_product.selling_price_minor
      )::jsonb
    );
  END LOOP;

  IF (SELECT count(*) FROM jsonb_object_keys(v_product_map)) != v_item_count THEN
    RAISE EXCEPTION 'Validation error: One or more products were not found in catalog' USING ERRCODE = 'P0002';
  END IF;

  -- 6. Pass 1: Validate stock, chronology, prices, item discounts and accumulate subtotal
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_prod_id := (v_item->>'product_id')::uuid;
    v_qty := (v_item->>'quantity')::integer;
    v_unit_price_minor := COALESCE(
      (v_item->>'unit_price_minor')::bigint,
      (v_product_map->v_prod_id::text->>'selling_price_minor')::bigint
    );
    v_item_disc_type := COALESCE((v_item->>'discount_type')::public.discount_type, 'none'::public.discount_type);
    v_item_disc_val := COALESCE((v_item->>'discount_value')::bigint, 0);

    -- Check available current stock
    IF v_qty <= 0 OR v_qty > 100000000 THEN
      RAISE EXCEPTION 'Validation error: Quantity must be positive and <= 100 000 000' USING ERRCODE = '22003';
    END IF;
    IF (v_product_map->v_prod_id::text->>'stock')::integer < v_qty THEN
      RAISE EXCEPTION 'Insufficient stock for product "%" (available: %, requested: %)',
        (v_product_map->v_prod_id::text->>'name'),
        (v_product_map->v_prod_id::text->>'stock')::integer,
        v_qty
        USING ERRCODE = '22023';
    END IF;

    -- Strict Chronology Guard: verify balance at document date and all strictly subsequent movements
    SELECT COALESCE(sum(quantity_delta), 0)::integer
    INTO v_future_delta_sum
    FROM public.stock_movements
    WHERE product_id = v_prod_id AND occurred_at > v_sold_at;

    v_historical_balance_before := (v_product_map->v_prod_id::text->>'stock')::integer - v_future_delta_sum;
    v_historical_balance_after := v_historical_balance_before - v_qty;

    IF v_historical_balance_after < 0 THEN
      RAISE EXCEPTION 'Validation error: Sale at "%" would cause negative historical stock (%) for product "%"',
        v_sold_at,
        v_historical_balance_after,
        (v_product_map->v_prod_id::text->>'name')
        USING ERRCODE = '22023';
    END IF;

    SELECT min(balance_after)
    INTO v_min_future_balance
    FROM public.stock_movements
    WHERE product_id = v_prod_id AND occurred_at > v_sold_at;

    IF v_min_future_balance IS NOT NULL AND (v_min_future_balance - v_qty) < 0 THEN
      RAISE EXCEPTION 'Validation error: Sale at "%" would cause negative subsequent historical stock for product "%"',
        v_sold_at,
        (v_product_map->v_prod_id::text->>'name')
        USING ERRCODE = '22023';
    END IF;

    IF v_unit_price_minor < 0 OR v_unit_price_minor > 10000000000 THEN
      RAISE EXCEPTION 'Validation error: Unit selling price must be between 0 and 100 000 000 som' USING ERRCODE = '22003';
    END IF;

    -- Look up exact effective purchase price from price history at historical document timestamp
    SELECT pph.purchase_price_minor
    INTO v_historical_cost_minor
    FROM public.product_price_history pph
    WHERE pph.product_id = v_prod_id
      AND pph.effective_from <= v_sold_at
    ORDER BY pph.effective_from DESC, pph.created_at DESC, pph.id DESC
    LIMIT 1;

    -- If no price history entry exists at or before v_sold_at, pick the earliest known historical price
    IF v_historical_cost_minor IS NULL THEN
      SELECT pph.purchase_price_minor
      INTO v_historical_cost_minor
      FROM public.product_price_history pph
      WHERE pph.product_id = v_prod_id
      ORDER BY pph.effective_from ASC, pph.created_at ASC, pph.id ASC
      LIMIT 1;
    END IF;

    v_cost_price_minor := COALESCE(v_historical_cost_minor, (v_product_map->v_prod_id::text->>'purchase_price_minor')::bigint);

    -- Arithmetic calculation for item gross and cost
    v_line_gross_minor := v_qty * v_unit_price_minor;
    v_line_cost_minor := v_qty * v_cost_price_minor;

    IF v_line_gross_minor > 9007199254740991 OR v_line_cost_minor > 9007199254740991 THEN
      RAISE EXCEPTION 'Validation error: Line monetary amounts exceed safe number bounds' USING ERRCODE = '22003';
    END IF;

    -- Calculate and strictly validate item discount
    IF v_item_disc_val < 0 OR v_item_disc_val > 9007199254740991 THEN
      RAISE EXCEPTION 'Validation error: Item discount value is out of safe bounds (0..9007199254740991)' USING ERRCODE = '22003';
    END IF;

    IF v_item_disc_type = 'percent'::public.discount_type THEN
      IF v_item_disc_val > 10000 THEN
        RAISE EXCEPTION 'Validation error: Item percent discount cannot exceed 100.00%% (10000 bps)' USING ERRCODE = '22003';
      END IF;
      -- Intermediate numeric calculation avoids any bigint overflow
      v_line_item_disc_minor := trunc((v_line_gross_minor::numeric * v_item_disc_val::numeric + 5000::numeric) / 10000::numeric)::bigint;
    ELSIF v_item_disc_type = 'fixed'::public.discount_type THEN
      IF v_item_disc_val > v_line_gross_minor THEN
        RAISE EXCEPTION 'Validation error: Item discount (%) exceeds item gross price (%)',
          v_item_disc_val, v_line_gross_minor
          USING ERRCODE = '22023';
      END IF;
      v_line_item_disc_minor := v_item_disc_val;
    ELSE
      v_line_item_disc_minor := 0;
    END IF;

    v_line_final_before_receipt_disc := v_line_gross_minor - v_line_item_disc_minor;

    v_subtotal_minor := v_subtotal_minor + v_line_gross_minor;
    v_item_discount_total_minor := v_item_discount_total_minor + v_line_item_disc_minor;
    v_eligible_subtotal_minor := v_eligible_subtotal_minor + v_line_final_before_receipt_disc;
    v_total_cost_minor := v_total_cost_minor + v_line_cost_minor;

    IF v_subtotal_minor > 9007199254740991 OR v_total_cost_minor > 9007199254740991 THEN
      RAISE EXCEPTION 'Validation error: Document total amounts exceed safe number bounds' USING ERRCODE = '22003';
    END IF;

    v_processed_items := v_processed_items || json_build_object(
      'product_id', v_prod_id,
      'quantity', v_qty,
      'unit_price_minor', v_unit_price_minor,
      'cost_price_minor', v_cost_price_minor,
      'gross_minor', v_line_gross_minor,
      'cost_minor', v_line_cost_minor,
      'discount_type', v_item_disc_type,
      'discount_value', v_item_disc_val,
      'item_discount_minor', v_line_item_disc_minor,
      'line_final_before_receipt_disc', v_line_final_before_receipt_disc
    )::jsonb;
  END LOOP;

  -- 7. Calculate and strictly validate receipt-level discount
  IF p_receipt_discount_type = 'percent'::public.discount_type THEN
    IF p_receipt_discount_value > 0 THEN
      IF p_receipt_discount_value >= 10000 THEN
        RAISE EXCEPTION 'Validation error: Receipt discount of 100%% is not allowed (total sale price must be > 0)' USING ERRCODE = '22023';
      END IF;
      -- Intermediate numeric calculation avoids any bigint overflow
      v_receipt_discount_minor := trunc((v_eligible_subtotal_minor::numeric * p_receipt_discount_value::numeric + 5000::numeric) / 10000::numeric)::bigint;
    ELSE
      v_receipt_discount_minor := 0;
    END IF;
  ELSIF p_receipt_discount_type = 'fixed'::public.discount_type THEN
    IF p_receipt_discount_value >= v_eligible_subtotal_minor THEN
      RAISE EXCEPTION 'Validation error: Receipt fixed discount (%) must be strictly less than total eligible amount (%)',
        p_receipt_discount_value, v_eligible_subtotal_minor
        USING ERRCODE = '22023';
    END IF;
    v_receipt_discount_minor := p_receipt_discount_value;
  ELSE
    v_receipt_discount_minor := 0;
  END IF;

  v_total_discount_minor := v_item_discount_total_minor + v_receipt_discount_minor;
  v_total_minor := v_eligible_subtotal_minor - v_receipt_discount_minor;
  v_profit_minor := v_total_minor - v_total_cost_minor;

  -- Total sale amount must be strictly greater than 0 som
  IF v_total_minor <= 0 THEN
    RAISE EXCEPTION 'Validation error: Sale total amount must be strictly greater than 0' USING ERRCODE = '22023';
  END IF;

  IF abs(v_profit_minor) > 9007199254740991 OR v_total_minor > 9007199254740991 THEN
    RAISE EXCEPTION 'Validation error: Resulting profit or total exceeds safe number bounds' USING ERRCODE = '22003';
  END IF;

  -- 8. Payment consistency validation
  IF p_payment_method = 'cash'::public.payment_method THEN
    IF p_received_minor IS NULL OR p_received_minor < v_total_minor THEN
      RAISE EXCEPTION 'Validation error: Received cash amount (%) is less than total price (%)',
        COALESCE(p_received_minor, 0),
        v_total_minor
        USING ERRCODE = '22023';
    END IF;
    IF p_received_minor > 9007199254740991 THEN
      RAISE EXCEPTION 'Validation error: Received cash amount exceeds safe number bounds' USING ERRCODE = '22003';
    END IF;
    v_received_minor := p_received_minor;
    v_change_minor := p_received_minor - v_total_minor;
  ELSE
    -- For card and transfer, schema consistency constraint requires both received_minor and change_minor to be NULL
    v_received_minor := NULL;
    v_change_minor := NULL;
  END IF;

  -- 9. Pre-calculate receipt discount allocation per item with safe remainder distribution
  v_allocations := ARRAY[]::bigint[];
  v_headrooms := ARRAY[]::bigint[];
  v_allocated_sum := 0;

  FOR v_item IN SELECT * FROM jsonb_array_elements(v_processed_items)
  LOOP
    v_line_final_before_receipt_disc := (v_item->>'line_final_before_receipt_disc')::bigint;

    IF v_receipt_discount_minor > 0 AND v_eligible_subtotal_minor > 0 THEN
      -- Floor allocation using numeric math
      v_allocated_receipt_disc := floor((v_line_final_before_receipt_disc::numeric * v_receipt_discount_minor::numeric) / v_eligible_subtotal_minor::numeric)::bigint;
      v_allocated_receipt_disc := LEAST(v_allocated_receipt_disc, v_line_final_before_receipt_disc);
    ELSE
      v_allocated_receipt_disc := 0;
    END IF;

    v_allocations := array_append(v_allocations, v_allocated_receipt_disc);
    v_headrooms := array_append(v_headrooms, v_line_final_before_receipt_disc - v_allocated_receipt_disc);
    v_allocated_sum := v_allocated_sum + v_allocated_receipt_disc;
  END LOOP;

  -- Distribute leftover 1-tyiyn units to items that have available headroom
  v_remainder := v_receipt_discount_minor - v_allocated_sum;
  IF v_remainder > 0 THEN
    FOR i IN 1..v_item_count
    LOOP
      IF v_remainder <= 0 THEN
        EXIT;
      END IF;
      IF v_headrooms[i] > 0 THEN
        v_allocations[i] := v_allocations[i] + 1;
        v_headrooms[i] := v_headrooms[i] - 1;
        v_remainder := v_remainder - 1;
      END IF;
    END LOOP;
  END IF;

  -- 10. Generate sequential receipt number without truncation
  v_seq_val := nextval('public.sale_receipt_seq');
  v_year := to_char(v_sold_at, 'YYYY');
  v_receipt_number := 'ЧЕК-' || v_year || '-' || lpad(v_seq_val::text, GREATEST(6, length(v_seq_val::text)), '0');

  -- 11. Insert master record into public.sales
  v_sale_id := COALESCE(p_id, gen_random_uuid());
  INSERT INTO public.sales (
    id,
    receipt_number,
    sold_at,
    payment_method,
    subtotal_minor,
    item_discount_total_minor,
    receipt_discount_type,
    receipt_discount_value,
    receipt_discount_minor,
    total_discount_minor,
    total_minor,
    received_minor,
    change_minor,
    profit_minor,
    status,
    comment,
    created_by,
    created_by_name,
    created_at
  ) VALUES (
    v_sale_id,
    v_receipt_number,
    v_sold_at,
    p_payment_method,
    v_subtotal_minor,
    v_item_discount_total_minor,
    p_receipt_discount_type,
    p_receipt_discount_value,
    v_receipt_discount_minor,
    v_total_discount_minor,
    v_total_minor,
    v_received_minor,
    v_change_minor,
    v_profit_minor,
    'completed'::public.document_status,
    v_comment,
    v_profile.profile_id,
    v_profile.full_name,
    clock_timestamp()
  );

  -- 12. Insert sale_items, update products stock, and record stock_movements
  v_idx := 0;
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_processed_items)
  LOOP
    v_idx := v_idx + 1;
    v_prod_id := (v_item->>'product_id')::uuid;
    v_qty := (v_item->>'quantity')::integer;
    v_unit_price_minor := (v_item->>'unit_price_minor')::bigint;
    v_cost_price_minor := (v_item->>'cost_price_minor')::bigint;
    v_line_gross_minor := (v_item->>'gross_minor')::bigint;
    v_line_cost_minor := (v_item->>'cost_minor')::bigint;
    v_item_disc_type := (v_item->>'discount_type')::public.discount_type;
    v_item_disc_val := (v_item->>'discount_value')::bigint;
    v_line_item_disc_minor := (v_item->>'item_discount_minor')::bigint;
    v_line_final_before_receipt_disc := (v_item->>'line_final_before_receipt_disc')::bigint;

    v_allocated_receipt_disc := v_allocations[v_idx];
    v_line_net_total_minor := v_line_final_before_receipt_disc - v_allocated_receipt_disc;
    v_line_profit_minor := v_line_net_total_minor - v_line_cost_minor;

    IF abs(v_line_profit_minor) > 9007199254740991 THEN
      RAISE EXCEPTION 'Validation error: Line profit exceeds safe number bounds' USING ERRCODE = '22003';
    END IF;

    -- Fetch current stock info from product map
    v_new_stock := (v_product_map->v_prod_id::text->>'stock')::integer - v_qty;

    -- Calculate chronologically accurate balance_after at document time
    SELECT COALESCE(sum(quantity_delta), 0)::integer
    INTO v_future_delta_sum
    FROM public.stock_movements
    WHERE product_id = v_prod_id AND occurred_at > v_sold_at;

    v_historical_balance_after := ((v_product_map->v_prod_id::text->>'stock')::integer - v_future_delta_sum) - v_qty;

    -- Shift future movements' balance_after by -v_qty
    UPDATE public.stock_movements
    SET balance_after = balance_after - v_qty
    WHERE product_id = v_prod_id AND occurred_at > v_sold_at;

    -- Insert sale item
    INSERT INTO public.sale_items (
      sale_id,
      product_id,
      product_name_snapshot,
      sku_snapshot,
      barcode_snapshot,
      quantity,
      purchase_price_snapshot_minor,
      selling_price_snapshot_minor,
      discount_type,
      discount_value,
      gross_minor,
      item_discount_minor,
      receipt_discount_allocated_minor,
      net_total_minor,
      cost_total_minor,
      profit_minor
    ) VALUES (
      v_sale_id,
      v_prod_id,
      (v_product_map->v_prod_id::text->>'name'),
      (v_product_map->v_prod_id::text->>'sku'),
      (v_product_map->v_prod_id::text->>'barcode'),
      v_qty,
      v_cost_price_minor,
      v_unit_price_minor,
      v_item_disc_type,
      v_item_disc_val,
      v_line_gross_minor,
      v_line_item_disc_minor,
      v_allocated_receipt_disc,
      v_line_net_total_minor,
      v_line_cost_minor,
      v_line_profit_minor
    );

    -- Update product stock
    UPDATE public.products
    SET
      stock = v_new_stock,
      updated_by = v_profile.profile_id,
      updated_at = clock_timestamp()
    WHERE id = v_prod_id;

    -- Create negative stock movement
    INSERT INTO public.stock_movements (
      product_id,
      movement_type,
      quantity_delta,
      balance_after,
      occurred_at,
      reference_id,
      reference_number,
      product_name_snapshot,
      sku_snapshot,
      responsible_id,
      responsible_name,
      note
    ) VALUES (
      v_prod_id,
      'sale'::public.movement_type,
      -v_qty,
      v_historical_balance_after,
      v_sold_at,
      v_sale_id,
      v_receipt_number,
      (v_product_map->v_prod_id::text->>'name'),
      (v_product_map->v_prod_id::text->>'sku'),
      v_profile.profile_id,
      v_profile.full_name,
      'Продажа по чеку ' || v_receipt_number
    );
  END LOOP;

  RETURN json_build_object(
    'id', v_sale_id,
    'receipt_number', v_receipt_number,
    'total_minor', v_total_minor,
    'profit_minor', v_profit_minor,
    'change_minor', v_change_minor,
    'items_count', v_item_count
  )::jsonb
    -- RBAC: profit_minor is returned to admins only (new receipt)
    - CASE WHEN v_profile.role = 'admin'::public.app_role THEN ARRAY[]::text[] ELSE ARRAY['profit_minor']::text[] END;
END;
$$;

-- ----------------------------------------------------------------------------
-- 6. PRIVILEGES
-- ----------------------------------------------------------------------------
-- Internal builder: never callable by clients (functions are executable by PUBLIC by default)
REVOKE ALL ON FUNCTION private.sales_page_rows(boolean, uuid, timestamptz, timestamptz, timestamptz, timestamptz, uuid, integer) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.rpc_list_sales(timestamptz, timestamptz, timestamptz, timestamptz, uuid, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_get_sale(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_has_any_sales() FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.rpc_list_sales(timestamptz, timestamptz, timestamptz, timestamptz, uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_get_sale(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_has_any_sales() TO authenticated;

-- rpc_create_sale: grants are preserved by CREATE OR REPLACE; restated for an explicit, idempotent state
REVOKE ALL ON FUNCTION public.rpc_create_sale(public.payment_method, public.discount_type, bigint, bigint, timestamptz, text, jsonb, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_create_sale(public.payment_method, public.discount_type, bigint, bigint, timestamptz, text, jsonb, uuid) TO authenticated;

-- ============================================================================
-- End of Migration
-- ============================================================================
