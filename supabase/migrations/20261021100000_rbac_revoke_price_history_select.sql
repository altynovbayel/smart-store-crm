-- ============================================================================
-- Migration: RBAC step 5 — close direct access to public.product_price_history
-- Version: 20261021100000
-- Name: rbac_revoke_price_history_select
-- Description:
--   Purchase price history is admin-only data. The frontend no longer reads the table
--   (the Outcome form uses rpc_get_purchase_prices_at, migration 20261020140000), so direct
--   PostgREST access is closed for every client role:
--
--   1. REVOKE ALL on the table from PUBLIC, anon and authenticated. Revoking a table privilege
--      also revokes the matching column privileges, so no column-level SELECT remains.
--   2. DROP POLICY product_price_history_select_active_staff (SELECT for ANY active staff
--      member, cashiers included). Without a policy RLS denies every row to non-owner roles,
--      so an accidental future GRANT cannot re-expose prices to a cashier (defense in depth).
--      RLS stays ENABLED.
--   3. Fail-closed assertions: the migration aborts (and rolls back) if anon / authenticated /
--      PUBLIC still hold any privilege on the table or its columns, if a policy remains, if RLS
--      is off, if FORCE ROW LEVEL SECURITY is on (the owner would then read nothing), or if a
--      function that uses the table is not SECURITY DEFINER or is owned by a role that can no
--      longer read it.
--
--   Not changed: the table owner (postgres) and service_role privileges, the table itself,
--   indexes, products, documents, any other table, any function or EXECUTE grant.
--
--   Still working after this migration (all SECURITY DEFINER, owned by the table owner, so
--   neither grants nor RLS apply to their internal reads/writes):
--     rpc_get_purchase_prices_at (admin-only read), rpc_create_product, rpc_update_product,
--     rpc_create_income_receipt, rpc_create_sale, rpc_create_outcome_document.
--
--   Rollback (a SEPARATE, NEW migration — never edit this one), restores the previous state
--   exactly (direct SELECT for every active staff member, cashiers included):
--     GRANT SELECT ON public.product_price_history TO authenticated;
--     DROP POLICY IF EXISTS product_price_history_select_active_staff ON public.product_price_history;
--     CREATE POLICY product_price_history_select_active_staff ON public.product_price_history
--     FOR SELECT TO authenticated
--     USING ((SELECT private.is_active_user()) = true);
-- ============================================================================

REVOKE ALL ON TABLE public.product_price_history FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS product_price_history_select_active_staff ON public.product_price_history;

ALTER TABLE public.product_price_history ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  v_role text;
  v_priv text;
  v_bad text;
BEGIN
  -- Client roles (has_*_privilege includes privileges inherited through PUBLIC)
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    FOREACH v_priv IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
      IF pg_catalog.has_table_privilege(v_role, 'public.product_price_history', v_priv) THEN
        RAISE EXCEPTION 'product_price_history: role % still has % privilege', v_role, v_priv;
      END IF;
    END LOOP;
    FOREACH v_priv IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'REFERENCES'] LOOP
      IF pg_catalog.has_any_column_privilege(v_role, 'public.product_price_history', v_priv) THEN
        RAISE EXCEPTION 'product_price_history: role % still has column % privilege', v_role, v_priv;
      END IF;
    END LOOP;
  END LOOP;

  -- No explicit PUBLIC entry in the table or column ACLs
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class c, pg_catalog.aclexplode(c.relacl) a
    WHERE c.oid = 'public.product_price_history'::regclass AND a.grantee = 0
  ) OR EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute att, pg_catalog.aclexplode(att.attacl) a
    WHERE att.attrelid = 'public.product_price_history'::regclass AND a.grantee = 0
  ) THEN
    RAISE EXCEPTION 'product_price_history: PUBLIC still has privileges';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_policy p WHERE p.polrelid = 'public.product_price_history'::regclass
  ) THEN
    RAISE EXCEPTION 'product_price_history: a row level security policy still exists';
  END IF;

  IF NOT (SELECT c.relrowsecurity FROM pg_catalog.pg_class c WHERE c.oid = 'public.product_price_history'::regclass) THEN
    RAISE EXCEPTION 'product_price_history: row level security is disabled';
  END IF;

  -- With FORCE and no policy even the owner would read nothing (the DEFINER functions would break)
  IF (SELECT c.relforcerowsecurity FROM pg_catalog.pg_class c WHERE c.oid = 'public.product_price_history'::regclass) THEN
    RAISE EXCEPTION 'product_price_history: FORCE ROW LEVEL SECURITY would hide rows from the owner';
  END IF;

  -- Every SECURITY DEFINER function that uses the table must run as a role that still reads it
  SELECT pg_catalog.string_agg(n.nspname || '.' || p.proname, ', ')
  INTO v_bad
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE p.prosrc LIKE '%product_price_history%'
    AND (
      NOT p.prosecdef
      OR NOT pg_catalog.has_table_privilege(p.proowner, 'public.product_price_history', 'SELECT')
    );
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'product_price_history: functions would lose access: %', v_bad;
  END IF;
END;
$$;
