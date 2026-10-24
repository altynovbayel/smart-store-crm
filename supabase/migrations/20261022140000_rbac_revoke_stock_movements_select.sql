-- ============================================================================
-- Migration: RBAC step 10 — close direct access to stock movements
-- Version: 20261022140000
-- Name: rbac_revoke_stock_movements_select
-- Description:
--   Stock movements carry admin-only data (notes with supplier names / write-off reasons,
--   responsible employees, document references). The frontend no longer reads the table: the
--   Warehouse page loads movement history through the role-aware rpc_list_product_movements
--   (migration 20261019100000; cashier rows have no note, responsible, reference_id, product name
--   snapshot or created_at), so direct PostgREST access is closed for every client role.
--
--   State found before this migration: owner postgres; ACL
--   {postgres=arwdDxtm, service_role=arwdDxtm (Supabase default privileges), authenticated=r};
--   no column ACLs; RLS enabled, not forced; one SELECT policy stock_movements_select_active_staff
--   (any active staff member, cashiers included); no triggers, views, rules or publications.
--   Functions using the table (all SECURITY DEFINER, owner postgres, they read / insert / update
--   movements as the owner): rpc_create_sale, rpc_create_income_receipt,
--   rpc_create_outcome_document, rpc_create_product, rpc_adjust_product_stock,
--   rpc_list_product_movements.
--
--   1. REVOKE ALL on the table from PUBLIC, anon and authenticated (column privileges are
--      revoked together with the table privileges).
--   2. DROP the stock_movements_select_active_staff policy. RLS stays ENABLED and without a
--      policy it denies every row to non-owner roles, so an accidental future GRANT cannot
--      re-expose movements to a cashier.
--   3. Fail-closed assertions (the migration aborts and rolls back) — see the DO block.
--
--   Not changed: postgres and service_role privileges, the table itself, constraints, indexes,
--   any other table, any function or EXECUTE grant.
--
--   Rollback (a SEPARATE, NEW migration — never edit this one), restores the previous state
--   exactly (direct SELECT for every active staff member, cashiers included):
--     GRANT SELECT ON public.stock_movements TO authenticated;
--     DROP POLICY IF EXISTS stock_movements_select_active_staff ON public.stock_movements;
--     CREATE POLICY stock_movements_select_active_staff ON public.stock_movements
--     FOR SELECT TO authenticated
--     USING ((SELECT private.is_active_user()) = true);
-- ============================================================================

REVOKE ALL ON TABLE public.stock_movements FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS stock_movements_select_active_staff ON public.stock_movements;

ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  v_table constant regclass := 'public.stock_movements'::regclass;
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
  -- role can execute (then it only runs inside such a DEFINER function)
  SELECT pg_catalog.string_agg(n.nspname || '.' || p.proname, ', ')
  INTO v_bad
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE p.prosrc ~ 'stock_movements'
    AND CASE
          WHEN p.prosecdef THEN NOT (
            pg_catalog.has_table_privilege(p.proowner, 'public.stock_movements', 'SELECT')
            AND pg_catalog.has_table_privilege(p.proowner, 'public.stock_movements', 'INSERT')
            AND pg_catalog.has_table_privilege(p.proowner, 'public.stock_movements', 'UPDATE')
          )
          ELSE (
            pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
            OR pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
          )
        END;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'stock_movements: functions would lose access or run as a client role: %', v_bad;
  END IF;

  -- The role-aware read RPC must exist and stay executable by authenticated only
  IF pg_catalog.to_regprocedure('public.rpc_list_product_movements(uuid, timestamptz, timestamptz, uuid, integer)') IS NULL THEN
    RAISE EXCEPTION 'stock_movements: rpc_list_product_movements from migration 20261019100000 is missing';
  END IF;
  IF NOT pg_catalog.has_function_privilege('authenticated', 'public.rpc_list_product_movements(uuid, timestamptz, timestamptz, uuid, integer)', 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', 'public.rpc_list_product_movements(uuid, timestamptz, timestamptz, uuid, integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'stock_movements: unexpected EXECUTE privileges on rpc_list_product_movements';
  END IF;
END;
$$;
