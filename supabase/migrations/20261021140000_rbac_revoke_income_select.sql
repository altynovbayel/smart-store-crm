-- ============================================================================
-- Migration: RBAC step 7 — close direct access to income receipts
-- Version: 20261021140000
-- Name: rbac_revoke_income_select
-- Description:
--   Income documents (supplier, purchase prices) are admin-only data. The frontend no longer
--   reads the tables (incomeApi uses rpc_list_income_receipts / rpc_get_income_receipt,
--   migration 20261021120000), so direct PostgREST access is closed for every client role.
--
--   State found before this migration (both tables): owner postgres; ACL
--   {postgres=arwdDxtm, service_role=arwdDxtm (Supabase default privileges), authenticated=r};
--   no column ACLs; RLS enabled, not forced; one SELECT policy *_select_active_staff
--   (any active staff member, cashiers included); no triggers, views, rules or publications.
--   Functions using the tables: rpc_create_income_receipt, rpc_list_income_receipts,
--   rpc_get_income_receipt (SECURITY DEFINER, owner postgres) and the internal builder
--   private.income_receipts_json (SECURITY INVOKER, no EXECUTE for any client role — it only
--   runs inside the two DEFINER read RPCs, i.e. as postgres).
--
--   1. REVOKE ALL on both tables from PUBLIC, anon and authenticated (column privileges are
--      revoked together with the table privileges).
--   2. DROP the two *_select_active_staff policies. RLS stays ENABLED and without a policy it
--      denies every row to non-owner roles, so an accidental future GRANT cannot re-expose the
--      documents to a cashier.
--   3. Fail-closed assertions (the migration aborts and rolls back) — see the DO block.
--
--   Not changed: postgres and service_role privileges, the tables themselves, constraints,
--   indexes, any other table, any function or EXECUTE grant.
--
--   Rollback (a SEPARATE, NEW migration — never edit this one), restores the previous state
--   exactly (direct SELECT for every active staff member, cashiers included):
--     GRANT SELECT ON public.income_receipts, public.income_items TO authenticated;
--     DROP POLICY IF EXISTS income_receipts_select_active_staff ON public.income_receipts;
--     CREATE POLICY income_receipts_select_active_staff ON public.income_receipts
--     FOR SELECT TO authenticated
--     USING ((SELECT private.is_active_user()) = true);
--     DROP POLICY IF EXISTS income_items_select_active_staff ON public.income_items;
--     CREATE POLICY income_items_select_active_staff ON public.income_items
--     FOR SELECT TO authenticated
--     USING ((SELECT private.is_active_user()) = true);
-- ============================================================================

REVOKE ALL ON TABLE public.income_receipts, public.income_items FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS income_receipts_select_active_staff ON public.income_receipts;
DROP POLICY IF EXISTS income_items_select_active_staff ON public.income_items;

ALTER TABLE public.income_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.income_items ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  v_table regclass;
  v_role text;
  v_priv text;
  v_bad text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['public.income_receipts'::regclass, 'public.income_items'::regclass] LOOP
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

    -- With FORCE and no policy even the owner would read nothing (the DEFINER RPCs would break)
    IF (SELECT c.relforcerowsecurity FROM pg_catalog.pg_class c WHERE c.oid = v_table) THEN
      RAISE EXCEPTION '%: FORCE ROW LEVEL SECURITY would hide rows from the owner', v_table;
    END IF;

    -- The owner keeps full access (service_role is intentionally not touched or asserted here)
    IF NOT pg_catalog.has_table_privilege(
         (SELECT c.relowner FROM pg_catalog.pg_class c WHERE c.oid = v_table), v_table, 'SELECT')
       OR NOT pg_catalog.has_table_privilege(
         (SELECT c.relowner FROM pg_catalog.pg_class c WHERE c.oid = v_table), v_table, 'INSERT') THEN
      RAISE EXCEPTION '%: owner lost SELECT / INSERT', v_table;
    END IF;
  END LOOP;

  -- Every function using the tables must still work:
  -- SECURITY DEFINER owned by a role that reads both tables, or SECURITY INVOKER that no client
  -- role can execute (then it only runs inside such a DEFINER function)
  SELECT pg_catalog.string_agg(n.nspname || '.' || p.proname, ', ')
  INTO v_bad
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE p.prosrc ~ 'income_(receipts|items)'
    AND CASE
          WHEN p.prosecdef THEN NOT (
            pg_catalog.has_table_privilege(p.proowner, 'public.income_receipts', 'SELECT')
            AND pg_catalog.has_table_privilege(p.proowner, 'public.income_items', 'SELECT')
          )
          ELSE (
            pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
            OR pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
          )
        END;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'income tables: functions would lose access or run as a client role: %', v_bad;
  END IF;

  -- The admin read RPCs must exist and stay executable by authenticated only
  IF pg_catalog.to_regprocedure('public.rpc_list_income_receipts(timestamptz, uuid, integer)') IS NULL
     OR pg_catalog.to_regprocedure('public.rpc_get_income_receipt(uuid)') IS NULL THEN
    RAISE EXCEPTION 'income tables: read RPCs from migration 20261021120000 are missing';
  END IF;
  IF NOT pg_catalog.has_function_privilege('authenticated', 'public.rpc_list_income_receipts(timestamptz, uuid, integer)', 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('authenticated', 'public.rpc_get_income_receipt(uuid)', 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', 'public.rpc_list_income_receipts(timestamptz, uuid, integer)', 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', 'public.rpc_get_income_receipt(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'income tables: unexpected EXECUTE privileges on the read RPCs';
  END IF;
END;
$$;
