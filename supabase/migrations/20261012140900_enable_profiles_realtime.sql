-- ============================================================================
-- Migration: Enable Supabase Realtime for public.profiles
-- Version: 20261012140900
-- Name: enable_profiles_realtime
-- Description:
--   Safely and idempotently adds public.profiles to the supabase_realtime
--   publication so that the React client (AuthProvider) can instantly detect
--   role changes (admin <-> cashier) and account deactivation (is_active = false)
--   in real time without polling.
-- ============================================================================

DO $$
BEGIN
  -- 1. Ensure supabase_realtime publication exists (created by default in Supabase)
  IF EXISTS (
    SELECT 1
    FROM pg_publication
    WHERE pubname = 'supabase_realtime'
  ) THEN
    -- 2. Add public.profiles only if not already present in supabase_realtime
    IF NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'profiles'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.profiles;
    END IF;
  END IF;
END $$;
