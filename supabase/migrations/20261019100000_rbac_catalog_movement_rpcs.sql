-- ============================================================================
-- Migration: RBAC step 1 — role-aware read-only RPCs for catalog and stock movements
-- Version: 20261019100000
-- Name: rbac_catalog_movement_rpcs
-- Description:
--   Additive, non-breaking step of the RBAC hardening plan (A1). Adds two read-only RPCs that
--   return ONLY the fields allowed for the caller's role, so that a later migration can revoke
--   direct SELECT on public.products / public.stock_movements without breaking the frontend.
--
--   1. public.rpc_list_products(p_include_archived, p_after_id, p_limit)
--   2. public.rpc_list_product_movements(p_product_id, p_after_occurred_at, p_after_created_at,
--                                        p_after_id, p_limit)
--
--   Existing tables, grants, RLS policies and RPCs are NOT changed by this migration.
--
--   Security:
--   - SECURITY DEFINER: required so the functions keep working after the planned
--     REVOKE SELECT on the underlying tables. The function owner (migration role) bypasses RLS,
--     therefore every function FIRST resolves the caller's role with private.current_user_role()
--     (auth.uid(), role, is_active = true) and raises 42501 for anonymous / inactive / unknown users.
--   - Role-specific JSON is built with explicit field lists (no SELECT *, no row_to_json of rows):
--     cashier rows never contain purchase prices, authors, notes, suppliers or audit columns.
--   - STABLE, no writes, no dynamic SQL; search_path = pg_catalog, public, pg_temp (pg_temp last);
--     every object schema-qualified.
--   - EXECUTE revoked from PUBLIC / anon, granted to authenticated only.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. CATALOG
-- ----------------------------------------------------------------------------
-- JSON contract:
--   { "role": "admin" | "cashier",
--     "rows": [ <row> ... ]           -- ordered by id ASC, at most p_limit rows
--     "next_after_id": uuid | null }  -- set only when the page is full (a final empty page is possible)
--
--   admin row:   id, sku, barcode, name, category, category_label, description,
--                purchase_price_minor, selling_price_minor, stock, min_stock_threshold,
--                status, is_archived, created_at, updated_at
--   cashier row: id, sku, barcode, name, category, category_label,
--                selling_price_minor, stock, min_stock_threshold, status, is_archived
--   status: 'out_of_stock' (stock <= 0) | 'low_stock' (stock <= min_stock_threshold) | 'in_stock'
--   Never returned: created_by, updated_by (admin and cashier).
--
--   Pagination: keyset by the immutable primary key (id > p_after_id ORDER BY id), so renames or
--   stock changes during a multi-page load cause neither duplicates nor gaps. Display ordering
--   (e.g. by name) is the client's responsibility.
CREATE OR REPLACE FUNCTION public.rpc_list_products(
  p_include_archived boolean DEFAULT false,
  p_after_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 1000
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
  v_last_id uuid;
BEGIN
  -- Active profile (role + is_active) of auth.uid(); NULL for anonymous / inactive / missing
  v_role := private.current_user_role();
  IF v_role IS NULL OR v_role NOT IN ('admin'::public.app_role, 'cashier'::public.app_role) THEN
    RAISE EXCEPTION 'Forbidden: User profile is not active or does not exist'
      USING ERRCODE = '42501';
  END IF;

  IF p_include_archived IS NULL THEN
    RAISE EXCEPTION 'Validation error: p_include_archived must not be NULL'
      USING ERRCODE = '22023';
  END IF;

  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 1000 THEN
    RAISE EXCEPTION 'Validation error: Page size must be between 1 and 1000'
      USING ERRCODE = '22023';
  END IF;

  SELECT
    COALESCE(
      pg_catalog.jsonb_agg(
        CASE
          WHEN v_role = 'admin'::public.app_role THEN
            pg_catalog.jsonb_build_object(
              'id', page.id,
              'sku', page.sku,
              'barcode', page.barcode,
              'name', page.name,
              'category', page.category,
              'category_label', page.category_label,
              'description', page.description,
              'purchase_price_minor', page.purchase_price_minor,
              'selling_price_minor', page.selling_price_minor,
              'stock', page.stock,
              'min_stock_threshold', page.min_stock_threshold,
              'status', page.status,
              'is_archived', page.is_archived,
              'created_at', page.created_at,
              'updated_at', page.updated_at
            )
          ELSE
            pg_catalog.jsonb_build_object(
              'id', page.id,
              'sku', page.sku,
              'barcode', page.barcode,
              'name', page.name,
              'category', page.category,
              'category_label', page.category_label,
              'selling_price_minor', page.selling_price_minor,
              'stock', page.stock,
              'min_stock_threshold', page.min_stock_threshold,
              'status', page.status,
              'is_archived', page.is_archived
            )
        END
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
      p.description,
      p.purchase_price_minor,
      p.selling_price_minor,
      p.stock,
      p.min_stock_threshold,
      CASE
        WHEN p.stock <= 0 THEN 'out_of_stock'
        WHEN p.stock <= p.min_stock_threshold THEN 'low_stock'
        ELSE 'in_stock'
      END AS status,
      p.is_archived,
      p.created_at,
      p.updated_at
    FROM public.products AS p
    WHERE (p_include_archived OR p.is_archived = false)
      AND (p_after_id IS NULL OR p.id > p_after_id)
    ORDER BY p.id ASC
    LIMIT p_limit
  ) AS page;

  RETURN pg_catalog.jsonb_build_object(
    'role', v_role,
    'rows', v_rows,
    'next_after_id', CASE WHEN v_count = p_limit THEN v_last_id ELSE NULL END
  );
END;
$$;

COMMENT ON FUNCTION public.rpc_list_products(boolean, uuid, integer) IS
  'Role-aware catalog page (keyset by id, <= 1000 rows). Cashier rows omit purchase price, description and audit columns.';

-- ----------------------------------------------------------------------------
-- 2. STOCK MOVEMENTS OF ONE PRODUCT
-- ----------------------------------------------------------------------------
-- JSON contract:
--   { "role": "admin" | "cashier",
--     "rows": [ <row> ... ],          -- ordered by occurred_at DESC, created_at DESC, id DESC
--     "next_cursor": { "occurred_at": timestamptz, "created_at": timestamptz, "id": uuid } | null }
--
--   admin row:   id, product_id, movement_type, quantity_delta, balance_after, occurred_at,
--                created_at, reference_id, reference_number, product_name_snapshot,
--                note, responsible_name
--   cashier row: id, movement_type, quantity_delta, balance_after, occurred_at, reference_number
--   Never returned: responsible_id, sku_snapshot (admin and cashier); for cashier also note
--   (contains supplier names / write-off reasons), responsible_name, reference_id,
--   product_name_snapshot, created_at.
--
--   Pagination: keyset on (occurred_at, created_at, id) descending. The next page passes the three
--   values of next_cursor UNCHANGED (strings with microsecond precision — do not round-trip them
--   through JavaScript Date). Existing movements never change these columns, so there are no
--   duplicates or gaps among rows that exist during the load; a movement inserted later with an
--   older occurred_at (back-dated document) may appear on a later page or after a reload.
CREATE OR REPLACE FUNCTION public.rpc_list_product_movements(
  p_product_id uuid,
  p_after_occurred_at timestamptz DEFAULT NULL,
  p_after_created_at timestamptz DEFAULT NULL,
  p_after_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 1000
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
  v_last_occurred_at timestamptz;
  v_last_created_at timestamptz;
  v_last_id uuid;
BEGIN
  v_role := private.current_user_role();
  IF v_role IS NULL OR v_role NOT IN ('admin'::public.app_role, 'cashier'::public.app_role) THEN
    RAISE EXCEPTION 'Forbidden: User profile is not active or does not exist'
      USING ERRCODE = '42501';
  END IF;

  IF p_product_id IS NULL THEN
    RAISE EXCEPTION 'Validation error: Product id is required'
      USING ERRCODE = '22023';
  END IF;

  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 1000 THEN
    RAISE EXCEPTION 'Validation error: Page size must be between 1 and 1000'
      USING ERRCODE = '22023';
  END IF;

  -- Cursor must be complete (all three values) or absent
  v_has_cursor := p_after_occurred_at IS NOT NULL;
  IF (p_after_created_at IS NOT NULL) IS DISTINCT FROM v_has_cursor
     OR (p_after_id IS NOT NULL) IS DISTINCT FROM v_has_cursor THEN
    RAISE EXCEPTION 'Validation error: Cursor must contain occurred_at, created_at and id together'
      USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.products AS p WHERE p.id = p_product_id) THEN
    RAISE EXCEPTION 'Validation error: Product not found'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT
    COALESCE(
      pg_catalog.jsonb_agg(
        CASE
          WHEN v_role = 'admin'::public.app_role THEN
            pg_catalog.jsonb_build_object(
              'id', page.id,
              'product_id', page.product_id,
              'movement_type', page.movement_type,
              'quantity_delta', page.quantity_delta,
              'balance_after', page.balance_after,
              'occurred_at', page.occurred_at,
              'created_at', page.created_at,
              'reference_id', page.reference_id,
              'reference_number', page.reference_number,
              'product_name_snapshot', page.product_name_snapshot,
              'note', page.note,
              'responsible_name', page.responsible_name
            )
          ELSE
            pg_catalog.jsonb_build_object(
              'id', page.id,
              'movement_type', page.movement_type,
              'quantity_delta', page.quantity_delta,
              'balance_after', page.balance_after,
              'occurred_at', page.occurred_at,
              'reference_number', page.reference_number
            )
        END
        ORDER BY page.occurred_at DESC, page.created_at DESC, page.id DESC
      ),
      '[]'::jsonb
    ),
    pg_catalog.count(*)::integer,
    -- Cursor = last row of the page in the DESC order (= first in ASC order)
    (pg_catalog.array_agg(page.occurred_at ORDER BY page.occurred_at ASC, page.created_at ASC, page.id ASC))[1],
    (pg_catalog.array_agg(page.created_at ORDER BY page.occurred_at ASC, page.created_at ASC, page.id ASC))[1],
    (pg_catalog.array_agg(page.id ORDER BY page.occurred_at ASC, page.created_at ASC, page.id ASC))[1]
  INTO v_rows, v_count, v_last_occurred_at, v_last_created_at, v_last_id
  FROM (
    SELECT
      m.id,
      m.product_id,
      m.movement_type,
      m.quantity_delta,
      m.balance_after,
      m.occurred_at,
      m.created_at,
      m.reference_id,
      m.reference_number,
      m.product_name_snapshot,
      m.note,
      m.responsible_name
    FROM public.stock_movements AS m
    WHERE m.product_id = p_product_id
      AND (
        NOT v_has_cursor
        OR (m.occurred_at, m.created_at, m.id) < (p_after_occurred_at, p_after_created_at, p_after_id)
      )
    ORDER BY m.occurred_at DESC, m.created_at DESC, m.id DESC
    LIMIT p_limit
  ) AS page;

  RETURN pg_catalog.jsonb_build_object(
    'role', v_role,
    'rows', v_rows,
    'next_cursor',
      CASE
        WHEN v_count = p_limit THEN
          pg_catalog.jsonb_build_object(
            'occurred_at', v_last_occurred_at,
            'created_at', v_last_created_at,
            'id', v_last_id
          )
        ELSE NULL
      END
  );
END;
$$;

COMMENT ON FUNCTION public.rpc_list_product_movements(uuid, timestamptz, timestamptz, uuid, integer) IS
  'Role-aware stock movement page of one product (keyset on occurred_at, created_at, id DESC; <= 1000 rows). Cashier rows omit notes, suppliers and responsible data.';

-- ----------------------------------------------------------------------------
-- 3. PRIVILEGES: authenticated only (active role enforced inside)
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.rpc_list_products(boolean, uuid, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_list_product_movements(uuid, timestamptz, timestamptz, uuid, integer) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.rpc_list_products(boolean, uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_list_product_movements(uuid, timestamptz, timestamptz, uuid, integer) TO authenticated;

-- ============================================================================
-- End of Migration
-- ============================================================================
