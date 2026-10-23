-- ============================================================================
-- Migration: RBAC step 13 — read-only RPC for the caller's own profile
-- Version: 20261022200000
-- Name: rbac_my_profile_rpc
-- Description:
--   Additive step. Adds public.rpc_get_my_profile() so that AuthProvider can load the signed-in
--   user's role / activity without direct SELECT on public.profiles; a later migration can then
--   narrow direct access to profiles (see the profiles / Realtime audit).
--
--   Contract:
--     { "profile": { "id": uuid, "full_name": text, "role": "admin" | "cashier",
--                    "is_active": boolean } | null }
--   - the profile is looked up ONLY by auth.uid(); the function has no arguments;
--   - an inactive user receives their own profile with is_active = false (the client shows
--     "account not activated" and signs out);
--   - no profile row for auth.uid() → profile = null;
--   - no auth.uid() (anonymous / no JWT subject) → 42501.
--   Never returned: created_at, updated_at, any other user's data.
--
--   Security:
--   - SECURITY DEFINER (keeps working after a future REVOKE SELECT on profiles), STABLE,
--     search_path = pg_catalog, pg_temp, every object schema-qualified, explicit field list.
--   - EXECUTE: revoked from PUBLIC and anon, granted to authenticated only.
--
--   Not changed: public.profiles, its grants, RLS policies, the supabase_realtime publication,
--   any other function.
--
--   Rollback (a SEPARATE, NEW migration — never edit this one; nothing else depends on it until
--   the frontend is switched):
--     DROP FUNCTION IF EXISTS public.rpc_get_my_profile();
-- ============================================================================

CREATE OR REPLACE FUNCTION public.rpc_get_my_profile()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_uid uuid;
  v_profile jsonb;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Forbidden: User is not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT pg_catalog.jsonb_build_object(
           'id', p.id,
           'full_name', p.full_name,
           'role', p.role,
           'is_active', p.is_active
         )
  INTO v_profile
  FROM public.profiles AS p
  WHERE p.id = v_uid;

  RETURN pg_catalog.jsonb_build_object('profile', v_profile);
END;
$$;

COMMENT ON FUNCTION public.rpc_get_my_profile() IS
  'Own profile of auth.uid(): { profile: { id, full_name, role, is_active } | null } (inactive users included). 42501 without auth.uid().';

REVOKE ALL ON FUNCTION public.rpc_get_my_profile() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_get_my_profile() TO authenticated;
