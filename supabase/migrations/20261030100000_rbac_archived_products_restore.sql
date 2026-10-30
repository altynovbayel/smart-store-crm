-- ============================================================================
-- Migration: Archived products — admin-only archive listing and restore
-- Version: 20261030100000
-- Name: rbac_archived_products_restore
-- Description:
--   Adds a read model for the warehouse "Архив товаров" view and a dedicated restore command,
--   and closes a cashier read path to archived products.
--
--   State found before this migration:
--   - public.rpc_list_products(p_include_archived, p_after_id, p_limit) (20261019100000) returned
--     archived rows to ANY active staff member when p_include_archived = true, i.e. a cashier
--     could list archived products with a forged request. The frontend always sends false.
--   - public.rpc_archive_product(uuid, boolean) (20261009120000) can unarchive, but returns the
--     raw public.products row (created_by / updated_by included) — no strict contract.
--   - Direct access to public.products is closed for every client role (20261022160000).
--
--   1. public.rpc_list_products — CREATE OR REPLACE with the IDENTICAL body and contract plus one
--      check: p_include_archived = true raises 42501 for every non-admin caller.
--   2. public.rpc_list_archived_products(p_after_id, p_limit) — admin-only page of archived
--      products (is_archived = true).
--   3. public.rpc_restore_product(p_product_id) — admin-only, idempotent restore.
--   4. EXECUTE: authenticated only (revoked from PUBLIC and anon).
--   5. Fail-closed assertions (the migration aborts and rolls back) — see the DO block.
--
--   Security (both new functions):
--   - SECURITY DEFINER (the table has no client privileges), owner = migration role;
--     search_path = pg_catalog, public, pg_temp (pg_temp last); every object schema-qualified.
--   - The caller is resolved FIRST with private.get_active_profile(true): auth.uid() IS NULL →
--     28000; missing / inactive profile → 42501; role <> admin → 42501. Nothing about the product
--     (not even its existence) is revealed before this check.
--   - Explicit field lists (no SELECT *, no row_to_json of rows); created_by / updated_by are
--     never returned.
--
--   Not changed: tables, columns, constraints, indexes, triggers, RLS, table privileges, any other
--   function. No data is modified by this migration.
--
--   Rollback (a SEPARATE, NEW migration — never edit this one):
--     DROP FUNCTION IF EXISTS public.rpc_restore_product(uuid);
--     DROP FUNCTION IF EXISTS public.rpc_list_archived_products(uuid, integer);
--     -- and re-create public.rpc_list_products from migration 20261019100000 unchanged
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. CATALOG: archived rows only for admin
-- ----------------------------------------------------------------------------
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

  -- Archived products are admin-only: a cashier never receives them, even with a forged request
  IF p_include_archived AND v_role IS DISTINCT FROM 'admin'::public.app_role THEN
    RAISE EXCEPTION 'Forbidden: Operation requires administrator privileges'
      USING ERRCODE = '42501';
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
  'Role-aware catalog page (keyset by id, <= 1000 rows). Cashier rows omit purchase price, description and audit columns. p_include_archived = true is admin-only.';

-- ----------------------------------------------------------------------------
-- 2. ARCHIVED CATALOG (admin only)
-- ----------------------------------------------------------------------------
-- JSON contract (identical to the admin response of rpc_list_products):
--   { "role": "admin",
--     "rows": [ <row> ... ],          -- only is_archived = true, ordered by id ASC, <= p_limit rows
--     "next_after_id": uuid | null }  -- set only when the page is full (a final empty page is possible)
--
--   row: id, sku, barcode, name, category, category_label, description, purchase_price_minor,
--        selling_price_minor, stock, min_stock_threshold, status, is_archived (always true),
--        created_at, updated_at
--   status: 'out_of_stock' (stock <= 0) | 'low_stock' (stock <= min_stock_threshold) | 'in_stock'
CREATE OR REPLACE FUNCTION public.rpc_list_archived_products(
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
  v_profile record;
  v_rows jsonb;
  v_count integer;
  v_last_id uuid;
BEGIN
  -- 28000 without auth.uid(); 42501 for a missing / inactive profile or a non-admin role
  SELECT * INTO v_profile FROM private.get_active_profile(true);

  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 1000 THEN
    RAISE EXCEPTION 'Validation error: Page size must be between 1 and 1000'
      USING ERRCODE = '22023';
  END IF;

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
    WHERE p.is_archived = true
      AND (p_after_id IS NULL OR p.id > p_after_id)
    ORDER BY p.id ASC
    LIMIT p_limit
  ) AS page;

  RETURN pg_catalog.jsonb_build_object(
    'role', v_profile.role,
    'rows', v_rows,
    'next_after_id', CASE WHEN v_count = p_limit THEN v_last_id ELSE NULL END
  );
END;
$$;

COMMENT ON FUNCTION public.rpc_list_archived_products(uuid, integer) IS
  'Admin-only page of archived products (keyset by id, <= 1000 rows); same row contract as the admin rpc_list_products.';

-- ----------------------------------------------------------------------------
-- 3. RESTORE (admin only, idempotent)
-- ----------------------------------------------------------------------------
-- JSON contract:
--   { "restored": boolean,   -- true: archived → active now; false: the product was already active
--     "product": <row> }     -- the same 15 fields as an admin catalog row, is_archived = false
--
--   Only is_archived, updated_by and updated_at change. Stock, prices, SKU, barcode, price history
--   and stock movements are untouched; NO stock movement is created (the quantity does not change).
--   Concurrency: the product row is locked FOR UPDATE, so two restores are serialized and the
--   second one returns restored = false. The caller's profile row is locked FOR SHARE and
--   re-checked, so a concurrent demotion / deactivation either waits for this transaction or is
--   seen here (then 42501 and nothing changes).
--   Errors: 28000 / 42501 (see header), 22023 for a NULL id, P0002 for an unknown product.
CREATE OR REPLACE FUNCTION public.rpc_restore_product(
  p_product_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_profile record;
  v_product public.products;
  v_restored boolean := false;
BEGIN
  -- 28000 without auth.uid(); 42501 for a missing / inactive profile or a non-admin role
  SELECT * INTO v_profile FROM private.get_active_profile(true);

  -- Hold the caller's role for the whole transaction (latest committed version is re-checked)
  PERFORM 1
  FROM public.profiles AS pr
  WHERE pr.id = v_profile.profile_id
    AND pr.is_active = true
    AND pr.role = 'admin'::public.app_role
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Forbidden: Operation requires administrator privileges'
      USING ERRCODE = '42501';
  END IF;

  IF p_product_id IS NULL THEN
    RAISE EXCEPTION 'Validation error: Product id is required'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_product
  FROM public.products AS p
  WHERE p.id = p_product_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Validation error: Product not found'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_product.is_archived THEN
    UPDATE public.products AS p
    SET
      is_archived = false,
      updated_by = v_profile.profile_id,
      updated_at = pg_catalog.clock_timestamp()
    WHERE p.id = p_product_id
    RETURNING * INTO v_product;
    v_restored := true;
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'restored', v_restored,
    'product', pg_catalog.jsonb_build_object(
      'id', v_product.id,
      'sku', v_product.sku,
      'barcode', v_product.barcode,
      'name', v_product.name,
      'category', v_product.category,
      'category_label', v_product.category_label,
      'description', v_product.description,
      'purchase_price_minor', v_product.purchase_price_minor,
      'selling_price_minor', v_product.selling_price_minor,
      'stock', v_product.stock,
      'min_stock_threshold', v_product.min_stock_threshold,
      'status',
        CASE
          WHEN v_product.stock <= 0 THEN 'out_of_stock'
          WHEN v_product.stock <= v_product.min_stock_threshold THEN 'low_stock'
          ELSE 'in_stock'
        END,
      'is_archived', v_product.is_archived,
      'created_at', v_product.created_at,
      'updated_at', v_product.updated_at
    )
  );
END;
$$;

COMMENT ON FUNCTION public.rpc_restore_product(uuid) IS
  'Admin-only idempotent restore of an archived product (no stock movement). Returns {restored, product} with the admin catalog row contract.';

-- ----------------------------------------------------------------------------
-- 4. PRIVILEGES: authenticated only (active admin enforced inside)
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.rpc_list_products(boolean, uuid, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_list_archived_products(uuid, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_restore_product(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.rpc_list_products(boolean, uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_list_archived_products(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_restore_product(uuid) TO authenticated;

-- ----------------------------------------------------------------------------
-- 5. FAIL-CLOSED ASSERTIONS
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_fn regprocedure;
  v_priv text;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'public.rpc_list_products(boolean, uuid, integer)'::regprocedure,
    'public.rpc_list_archived_products(uuid, integer)'::regprocedure,
    'public.rpc_restore_product(uuid)'::regprocedure
  ] LOOP
    IF NOT (SELECT p.prosecdef FROM pg_catalog.pg_proc p WHERE p.oid = v_fn) THEN
      RAISE EXCEPTION '%: must be SECURITY DEFINER', v_fn;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc p, unnest(p.proconfig) AS c(setting)
      WHERE p.oid = v_fn AND c.setting = 'search_path=pg_catalog, public, pg_temp'
    ) THEN
      RAISE EXCEPTION '%: fixed search_path is missing', v_fn;
    END IF;
    IF pg_catalog.has_function_privilege('anon', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION '%: anon still has EXECUTE', v_fn;
    END IF;
    IF NOT pg_catalog.has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION '%: authenticated lost EXECUTE', v_fn;
    END IF;
    IF EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc p, pg_catalog.aclexplode(p.proacl) a
      WHERE p.oid = v_fn AND a.grantee = 0
    ) THEN
      RAISE EXCEPTION '%: PUBLIC still has EXECUTE', v_fn;
    END IF;
  END LOOP;

  -- Direct table access stays closed (migration 20261022160000)
  FOREACH v_priv IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE'] LOOP
    IF pg_catalog.has_table_privilege('anon', 'public.products', v_priv)
       OR pg_catalog.has_table_privilege('authenticated', 'public.products', v_priv) THEN
      RAISE EXCEPTION 'public.products: a client role has % privilege', v_priv;
    END IF;
  END LOOP;
END;
$$;

-- ============================================================================
-- End of Migration
-- ============================================================================
