-- ============================================================================
-- Migration: RBAC step 12 — close direct access to sales receipts
-- Version: 20261022180000
-- Name: rbac_revoke_sales_select
-- Description:
--   Sales receipts carry admin-only cost data (sales.profit_minor,
--   sale_items.purchase_price_snapshot_minor / cost_total_minor / profit_minor) and internal
--   profile ids. The frontend reads sales only through the role-aware RPCs of migration
--   20261020100000 (rpc_list_sales, rpc_get_sale, rpc_has_any_sales; cashier rows have no cost
--   or profit fields) and conducts sales through rpc_create_sale, so direct PostgREST access is
--   closed for every client role.
--
--   State found before this migration (both tables): owner postgres; ACL
--   {postgres=arwdDxtm, service_role=arwdDxtm (Supabase default privileges), authenticated=r};
--   no column ACLs; RLS enabled, not forced; one SELECT policy *_select_active_staff
--   (any active staff member, cashiers included); no write policies; no views, rules or
--   publications. Trigger: enforce_sale_item_catalog_price (BEFORE INSERT on sale_items,
--   SECURITY INVOKER, reads products only; fires inside rpc_create_sale as the owner).
--   Functions using the tables (SECURITY DEFINER, owner postgres): rpc_create_sale,
--   rpc_list_sales, rpc_get_sale, rpc_has_any_sales, rpc_get_dashboard_sales_summary,
--   rpc_get_sales_report, rpc_create_income_receipt (back-dating guard reads sale_items); and
--   the internal builder private.sales_page_rows (SECURITY INVOKER, no EXECUTE for any client
--   role — it only runs inside rpc_list_sales / rpc_get_sale, i.e. as postgres).
--
--   1. REVOKE ALL on both tables from PUBLIC, anon and authenticated (column privileges are
--      revoked together with the table privileges).
--   2. DROP the two *_select_active_staff policies. RLS stays ENABLED and without a policy it
--      denies every row to non-owner roles, so an accidental future GRANT cannot re-expose cost
--      data to a cashier.
--   3. Fail-closed assertions (the migration aborts and rolls back) — see the DO block.
--
--   Not changed: postgres and service_role privileges, the tables themselves, constraints,
--   indexes, triggers, any other table (profiles included), any function or EXECUTE grant.
--
--   Rollback (a SEPARATE, NEW migration — never edit this one), restores the previous state
--   exactly (direct SELECT for every active staff member, cashiers included):
--     GRANT SELECT ON public.sales, public.sale_items TO authenticated;
--     DROP POLICY IF EXISTS sales_select_active_staff ON public.sales;
--     CREATE POLICY sales_select_active_staff ON public.sales
--     FOR SELECT TO authenticated
--     USING ((SELECT private.is_active_user()) = true);
--     DROP POLICY IF EXISTS sale_items_select_active_staff ON public.sale_items;
--     CREATE POLICY sale_items_select_active_staff ON public.sale_items
--     FOR SELECT TO authenticated
--     USING ((SELECT private.is_active_user()) = true);
-- ============================================================================

REVOKE ALL ON TABLE public.sales, public.sale_items FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS sales_select_active_staff ON public.sales;
DROP POLICY IF EXISTS sale_items_select_active_staff ON public.sale_items;

ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sale_items ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  v_table regclass;
  v_owner oid;
  v_role text;
  v_priv text;
  v_bad text;
  v_fn text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['public.sales'::regclass, 'public.sale_items'::regclass] LOOP
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

    -- The owner keeps what rpc_create_sale and the read RPCs need (service_role is intentionally
    -- not touched or asserted here)
    SELECT c.relowner INTO v_owner FROM pg_catalog.pg_class c WHERE c.oid = v_table;
    FOREACH v_priv IN ARRAY ARRAY['SELECT', 'INSERT'] LOOP
      IF NOT pg_catalog.has_table_privilege(v_owner, v_table, v_priv) THEN
        RAISE EXCEPTION '%: owner lost % privilege', v_table, v_priv;
      END IF;
    END LOOP;
  END LOOP;

  -- Every function using the tables must still work:
  -- SECURITY DEFINER owned by a role that reads and inserts both tables, or SECURITY INVOKER
  -- that no client role can execute and, when it is a trigger function, that fires only on
  -- tables no client role can write (then it only runs inside such a DEFINER function)
  SELECT pg_catalog.string_agg(n.nspname || '.' || p.proname, ', ')
  INTO v_bad
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE p.prosrc ~ '\m(sales|sale_items)\M'
    AND CASE
          WHEN p.prosecdef THEN NOT (
            pg_catalog.has_table_privilege(p.proowner, 'public.sales', 'SELECT')
            AND pg_catalog.has_table_privilege(p.proowner, 'public.sales', 'INSERT')
            AND pg_catalog.has_table_privilege(p.proowner, 'public.sale_items', 'SELECT')
            AND pg_catalog.has_table_privilege(p.proowner, 'public.sale_items', 'INSERT')
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
    RAISE EXCEPTION 'sales tables: functions would lose access or run as a client role: %', v_bad;
  END IF;

  -- The role-aware sales RPCs must exist and stay executable by authenticated only
  FOREACH v_fn IN ARRAY ARRAY[
    'public.rpc_list_sales(timestamptz, timestamptz, timestamptz, timestamptz, uuid, integer)',
    'public.rpc_get_sale(uuid)',
    'public.rpc_has_any_sales()',
    'public.rpc_create_sale(public.payment_method, public.discount_type, bigint, bigint, timestamptz, text, jsonb, uuid)'
  ] LOOP
    IF pg_catalog.to_regprocedure(v_fn) IS NULL THEN
      RAISE EXCEPTION 'sales tables: % is missing', v_fn;
    END IF;
    IF NOT pg_catalog.has_function_privilege('authenticated', v_fn::regprocedure, 'EXECUTE')
       OR pg_catalog.has_function_privilege('anon', v_fn::regprocedure, 'EXECUTE') THEN
      RAISE EXCEPTION 'sales tables: unexpected EXECUTE privileges on %', v_fn;
    END IF;
  END LOOP;
END;
$$;
