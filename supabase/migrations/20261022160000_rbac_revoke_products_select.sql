-- ============================================================================
-- Migration: RBAC step 11 — close direct access to the product catalog table
-- Version: 20261022160000
-- Name: rbac_revoke_products_select
-- Description:
--   public.products holds admin-only columns (purchase_price_minor, description, created_by,
--   updated_by, audit timestamps). The frontend reads the catalog only through the role-aware
--   rpc_list_products (migration 20261019100000; cashier rows have no purchase price,
--   description or audit columns) and changes it only through SECURITY DEFINER RPCs, so direct
--   PostgREST access is closed for every client role. A cashier can no longer read
--   purchase_price_minor with a REST request (directly or through an embed from sale_items).
--
--   State found before this migration: owner postgres; ACL
--   {postgres=arwdDxtm, service_role=arwdDxtm (Supabase default privileges), authenticated=r};
--   no column ACLs; RLS enabled, not forced; one SELECT policy products_select_active_staff
--   (any active staff member, cashiers included); no write policies; no views, rules or
--   publications (Realtime publishes profiles only).
--   Triggers: set_products_updated_at (BEFORE UPDATE on products, public.set_updated_at, does not
--   read any table) and enforce_sale_item_catalog_price (BEFORE INSERT on sale_items,
--   SECURITY INVOKER private.enforce_sale_item_catalog_price reads products; clients cannot
--   write sale_items, so it only fires inside rpc_create_sale, i.e. as the owner).
--   Functions using the table (all SECURITY DEFINER, owner postgres): rpc_list_products,
--   rpc_list_product_movements, rpc_create_product, rpc_update_product, rpc_archive_product,
--   rpc_adjust_product_stock, rpc_create_sale, rpc_create_income_receipt,
--   rpc_create_outcome_document, rpc_get_purchase_prices_at, rpc_get_dashboard_sales_summary,
--   rpc_get_dashboard_stock_summary, rpc_get_sales_report, rpc_get_warehouse_report,
--   rpc_get_warehouse_report_export. The four product write RPCs return the public.products row
--   type; returning a composite needs no table privilege.
--
--   1. REVOKE ALL on the table from PUBLIC, anon and authenticated (column privileges are
--      revoked together with the table privileges).
--   2. DROP the products_select_active_staff policy. RLS stays ENABLED and without a policy it
--      denies every row to non-owner roles, so an accidental future GRANT cannot re-expose the
--      catalog with purchase prices to a cashier.
--   3. Fail-closed assertions (the migration aborts and rolls back) — see the DO block.
--
--   Not changed: postgres and service_role privileges, the table itself, constraints, indexes,
--   triggers, any other table, any function or EXECUTE grant.
--
--   Rollback (a SEPARATE, NEW migration — never edit this one), restores the previous state
--   exactly (direct SELECT for every active staff member, cashiers included):
--     GRANT SELECT ON public.products TO authenticated;
--     DROP POLICY IF EXISTS products_select_active_staff ON public.products;
--     CREATE POLICY products_select_active_staff ON public.products
--     FOR SELECT TO authenticated
--     USING ((SELECT private.is_active_user()) = true);
-- ============================================================================

REVOKE ALL ON TABLE public.products FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS products_select_active_staff ON public.products;

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  v_table constant regclass := 'public.products'::regclass;
  v_owner oid;
  v_role text;
  v_priv text;
  v_bad text;
BEGIN
  -- Client roles (has_*_privilege includes privileges inherited through PUBLIC)
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    FOREACH v_priv IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
      IF pg_catalog.has_table_privilege(v_role, v_table, v_priv) THEN
        RAISE EXCEPTION '%: role % still has % privilege', v_table, v_role, v_priv;
      END IF;
    END LOOP;
    FOREACH v_priv IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'REFERENCES'] LOOP
      IF pg_catalog.has_any_column_privilege(v_role, v_table, v_priv) THEN
        RAISE EXCEPTION '%: role % still has column % privilege', v_table, v_role, v_priv;
      END IF;
    END LOOP;
  END LOOP;

  -- No explicit PUBLIC entry in the table or column ACLs
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_class c, pg_catalog.aclexplode(c.relacl) a
    WHERE c.oid = v_table AND a.grantee = 0
  ) OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute att, pg_catalog.aclexplode(att.attacl) a
    WHERE att.attrelid = v_table AND a.grantee = 0
  ) THEN
    RAISE EXCEPTION '%: PUBLIC still has privileges', v_table;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_catalog.pg_policy p WHERE p.polrelid = v_table) THEN
    RAISE EXCEPTION '%: a row level security policy still exists', v_table;
  END IF;

  IF NOT (SELECT c.relrowsecurity FROM pg_catalog.pg_class c WHERE c.oid = v_table) THEN
    RAISE EXCEPTION '%: row level security is disabled', v_table;
  END IF;

  -- With FORCE and no policy even the owner would see nothing (the DEFINER RPCs would break)
  IF (SELECT c.relforcerowsecurity FROM pg_catalog.pg_class c WHERE c.oid = v_table) THEN
    RAISE EXCEPTION '%: FORCE ROW LEVEL SECURITY would hide rows from the owner', v_table;
  END IF;

  -- The owner keeps what the DEFINER RPCs need (service_role is intentionally not touched or
  -- asserted here)
  SELECT c.relowner INTO v_owner FROM pg_catalog.pg_class c WHERE c.oid = v_table;
  FOREACH v_priv IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE'] LOOP
    IF NOT pg_catalog.has_table_privilege(v_owner, v_table, v_priv) THEN
      RAISE EXCEPTION '%: owner lost % privilege', v_table, v_priv;
    END IF;
  END LOOP;

  -- Every function using the table must still work:
  -- SECURITY DEFINER owned by a role that reads and writes it, or SECURITY INVOKER that no client
  -- role can execute and, when it is a trigger function, that fires only on tables no client
  -- role can write (then it only runs inside such a DEFINER function)
  SELECT pg_catalog.string_agg(n.nspname || '.' || p.proname, ', ')
  INTO v_bad
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE p.prosrc ~ 'products'
    AND CASE
          WHEN p.prosecdef THEN NOT (
            pg_catalog.has_table_privilege(p.proowner, 'public.products', 'SELECT')
            AND pg_catalog.has_table_privilege(p.proowner, 'public.products', 'INSERT')
            AND pg_catalog.has_table_privilege(p.proowner, 'public.products', 'UPDATE')
          )
          ELSE (
            pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
            OR pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
            OR EXISTS (
              SELECT 1
              FROM pg_catalog.pg_trigger t,
                   unnest(ARRAY['anon', 'authenticated']) AS r(role_name),
                   unnest(ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) AS w(priv)
              WHERE t.tgfoid = p.oid
                AND pg_catalog.has_table_privilege(r.role_name, t.tgrelid, w.priv)
            )
          )
        END;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'products: functions would lose access or run as a client role: %', v_bad;
  END IF;

  -- The role-aware catalog RPC must exist and stay executable by authenticated only
  IF pg_catalog.to_regprocedure('public.rpc_list_products(boolean, uuid, integer)') IS NULL THEN
    RAISE EXCEPTION 'products: rpc_list_products from migration 20261019100000 is missing';
  END IF;
  IF NOT pg_catalog.has_function_privilege('authenticated', 'public.rpc_list_products(boolean, uuid, integer)', 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', 'public.rpc_list_products(boolean, uuid, integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'products: unexpected EXECUTE privileges on rpc_list_products';
  END IF;
END;
$$;
