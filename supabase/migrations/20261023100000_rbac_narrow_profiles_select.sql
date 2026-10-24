-- ============================================================================
-- Migration: RBAC step 14 — narrow direct access to public.profiles
-- Version: 20261023100000
-- Name: rbac_narrow_profiles_select
-- Description:
--   The frontend loads the signed-in user's profile only through rpc_get_my_profile
--   (migration 20261022200000, AuthProvider). Direct SELECT on public.profiles is still needed by
--   ONE consumer: the Realtime postgres_changes subscription of AuthProvider on the user's own
--   row (role change / deactivation in an open tab). Realtime delivers a change only when the
--   subscriber may SELECT the row, so the own-row path stays, everything else is closed:
--
--   1. REVOKE ALL on the table from PUBLIC, anon and authenticated.
--   2. GRANT SELECT (id, role, is_active) to authenticated — column-level: full_name,
--      created_at and updated_at are no longer readable by REST (the client takes full_name from
--      rpc_get_my_profile; the Realtime callback ignores the payload).
--   3. DROP POLICY profiles_select_admin — no consumer (no user-management screen; documents
--      store name snapshots; server RPCs are SECURITY DEFINER). An admin can no longer read or
--      subscribe to other staff profiles directly.
--   4. KEEP profiles_select_own (id = auth.uid()) WITHOUT any is_active condition: an inactive
--      user must still receive the deactivation event for their own row.
--   5. Fail-closed assertions (the migration aborts and rolls back) — see the DO block.
--
--   State found before this migration: owner postgres; ACL
--   {postgres=arwdDxtm, service_role=arwdDxtm (Supabase default privileges), authenticated=r};
--   no column ACLs; RLS enabled, not forced; SELECT policies profiles_select_own and
--   profiles_select_admin; no write policies; trigger set_profiles_updated_at; table is in the
--   supabase_realtime publication (migration 20261012140900). Functions reading profiles (all
--   SECURITY DEFINER, owner postgres): private.current_user_role, private.is_active_user,
--   private.is_admin, private.get_active_profile, public.handle_new_user (trigger on
--   auth.users), public.rpc_get_my_profile.
--
--   Not changed: postgres and service_role privileges, the table, triggers, the publication,
--   any function or EXECUTE grant.
--
--   IMPORTANT — Realtime with column privileges is NOT proven by local SQL tests. Verify on a
--   test project before production (see the stage report). If own-row events stop arriving,
--   apply this SAFE FALLBACK as a SEPARATE, NEW migration (full own row readable, admin still
--   closed; profiles holds no secrets):
--     REVOKE SELECT (id, role, is_active) ON public.profiles FROM authenticated;
--     GRANT SELECT ON public.profiles TO authenticated;
--
--   Rollback (a SEPARATE, NEW migration — never edit this one), restores the previous state
--   exactly (full-row SELECT, admin reads every profile):
--     REVOKE SELECT (id, role, is_active) ON public.profiles FROM authenticated;
--     GRANT SELECT ON public.profiles TO authenticated;
--     DROP POLICY IF EXISTS profiles_select_admin ON public.profiles;
--     CREATE POLICY profiles_select_admin ON public.profiles
--     FOR SELECT TO authenticated
--     USING ((SELECT private.is_admin()) = true);
-- ============================================================================

REVOKE ALL ON TABLE public.profiles FROM PUBLIC, anon, authenticated;

GRANT SELECT (id, role, is_active) ON public.profiles TO authenticated;

DROP POLICY IF EXISTS profiles_select_admin ON public.profiles;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  v_table constant regclass := 'public.profiles'::regclass;
  v_owner oid;
  v_role text;
  v_priv text;
  v_col text;
  v_bad text;
  v_policy record;
BEGIN
  -- No table-level privilege for client roles (has_table_privilege includes PUBLIC)
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    FOREACH v_priv IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
      IF pg_catalog.has_table_privilege(v_role, v_table, v_priv) THEN
        RAISE EXCEPTION '%: role % still has table % privilege', v_table, v_role, v_priv;
      END IF;
    END LOOP;
    -- No column-level write / reference privilege at all
    FOREACH v_priv IN ARRAY ARRAY['INSERT', 'UPDATE', 'REFERENCES'] LOOP
      IF pg_catalog.has_any_column_privilege(v_role, v_table, v_priv) THEN
        RAISE EXCEPTION '%: role % has column % privilege', v_table, v_role, v_priv;
      END IF;
    END LOOP;
  END LOOP;

  IF pg_catalog.has_any_column_privilege('anon', v_table, 'SELECT') THEN
    RAISE EXCEPTION '%: anon can SELECT a column', v_table;
  END IF;

  -- authenticated: SELECT on exactly id, role, is_active
  FOR v_col IN
    SELECT att.attname FROM pg_catalog.pg_attribute att
    WHERE att.attrelid = v_table AND att.attnum > 0 AND NOT att.attisdropped
  LOOP
    IF pg_catalog.has_column_privilege('authenticated', v_table, v_col, 'SELECT')
       IS DISTINCT FROM (v_col IN ('id', 'role', 'is_active')) THEN
      RAISE EXCEPTION '%: unexpected SELECT privilege of authenticated on column % (expected only id, role, is_active)', v_table, v_col;
    END IF;
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

  -- Exactly one policy: permissive own-row SELECT for authenticated, without is_active
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_policy p WHERE p.polrelid = v_table) <> 1 THEN
    RAISE EXCEPTION '%: expected exactly one policy (profiles_select_own)', v_table;
  END IF;
  SELECT p.polname, p.polcmd, p.polpermissive, p.polroles,
         pg_catalog.pg_get_expr(p.polqual, p.polrelid) AS qual
  INTO v_policy
  FROM pg_catalog.pg_policy p
  WHERE p.polrelid = v_table;
  IF v_policy.polname <> 'profiles_select_own'
     OR v_policy.polcmd <> 'r'
     OR NOT v_policy.polpermissive
     OR v_policy.polroles <> ARRAY['authenticated'::regrole::oid]
     OR v_policy.qual IS NULL
     OR v_policy.qual !~ '^\(id = \( SELECT auth\.uid\(\) AS uid\)\)$' THEN
    RAISE EXCEPTION '%: profiles_select_own is not the expected own-row policy (id = auth.uid(), no is_active): %', v_table, v_policy.qual;
  END IF;

  IF NOT (SELECT c.relrowsecurity FROM pg_catalog.pg_class c WHERE c.oid = v_table) THEN
    RAISE EXCEPTION '%: row level security is disabled', v_table;
  END IF;

  -- With FORCE the owner would be limited by profiles_select_own (DEFINER helpers would break)
  IF (SELECT c.relforcerowsecurity FROM pg_catalog.pg_class c WHERE c.oid = v_table) THEN
    RAISE EXCEPTION '%: FORCE ROW LEVEL SECURITY would restrict the owner', v_table;
  END IF;

  -- The owner keeps what the DEFINER functions and handle_new_user need (service_role is
  -- intentionally not touched or asserted here)
  SELECT c.relowner INTO v_owner FROM pg_catalog.pg_class c WHERE c.oid = v_table;
  FOREACH v_priv IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE'] LOOP
    IF NOT pg_catalog.has_table_privilege(v_owner, v_table, v_priv) THEN
      RAISE EXCEPTION '%: owner lost % privilege', v_table, v_priv;
    END IF;
  END LOOP;

  -- Every function reading profiles must still work: SECURITY DEFINER owned by a role that
  -- reads the table, or SECURITY INVOKER that no client role can execute and, when it is a
  -- trigger function, that fires only on tables no client role can write
  SELECT pg_catalog.string_agg(n.nspname || '.' || p.proname, ', ')
  INTO v_bad
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE p.prosrc ~ '\mprofiles\M'
    AND CASE
          WHEN p.prosecdef THEN NOT pg_catalog.has_table_privilege(p.proowner, 'public.profiles', 'SELECT')
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
    RAISE EXCEPTION 'profiles: functions would lose access or run as a client role: %', v_bad;
  END IF;

  -- The client loads its profile through rpc_get_my_profile: it must exist, authenticated only
  IF pg_catalog.to_regprocedure('public.rpc_get_my_profile()') IS NULL THEN
    RAISE EXCEPTION 'profiles: rpc_get_my_profile from migration 20261022200000 is missing';
  END IF;
  IF NOT (SELECT p.prosecdef FROM pg_catalog.pg_proc p WHERE p.oid = 'public.rpc_get_my_profile()'::regprocedure)
     OR NOT pg_catalog.has_function_privilege('authenticated', 'public.rpc_get_my_profile()', 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', 'public.rpc_get_my_profile()', 'EXECUTE') THEN
    RAISE EXCEPTION 'profiles: rpc_get_my_profile must be SECURITY DEFINER and executable by authenticated only';
  END IF;

  -- The own-row Realtime subscription needs the table in supabase_realtime (when it exists)
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_publication pub WHERE pub.pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_publication_tables pt
       WHERE pt.pubname = 'supabase_realtime' AND pt.schemaname = 'public' AND pt.tablename = 'profiles'
     ) THEN
    RAISE EXCEPTION 'profiles: table is missing from the supabase_realtime publication';
  END IF;
END;
$$;
