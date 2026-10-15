-- Nexus Community Wishlist: least-privilege table grants
-- Review this script before running it in Supabase SQL Editor.
-- This changes privileges only; it does not alter rows, tables, or RLS policies.
--
-- Intended access:
--   anon: read public requests and votes
--   authenticated: read, create requests, upvote, and remove own requests/votes
-- RLS policies continue to restrict which rows authenticated users may change.
-- The server-side admin-delete route uses service_role and is not changed here.

BEGIN;

-- Fail safely if this script is run against the wrong project/schema or if RLS
-- has not been enabled. Do not grant authenticated write privileges otherwise.
DO $nexus$
BEGIN
  IF to_regclass('public.nexus_syllabus_requests') IS NULL
     OR to_regclass('public.nexus_syllabus_votes') IS NULL THEN
    RAISE EXCEPTION 'Nexus community tables are missing; no privilege changes applied.';
  END IF;

  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass('public.nexus_syllabus_requests'))
     OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass('public.nexus_syllabus_votes')) THEN
    RAISE EXCEPTION 'RLS must be enabled on both Nexus community tables before changing grants.';
  END IF;

  -- Ensure the policies needed by the current app flows exist before reducing grants.
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'nexus_syllabus_requests' AND cmd IN ('SELECT', 'ALL'))
     OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'nexus_syllabus_requests' AND cmd IN ('INSERT', 'ALL'))
     OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'nexus_syllabus_requests' AND cmd IN ('DELETE', 'ALL'))
     OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'nexus_syllabus_votes' AND cmd IN ('SELECT', 'ALL'))
     OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'nexus_syllabus_votes' AND cmd IN ('INSERT', 'ALL'))
     OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'nexus_syllabus_votes' AND cmd IN ('DELETE', 'ALL')) THEN
    RAISE EXCEPTION 'Required SELECT/INSERT/DELETE RLS policies are missing; no privilege changes applied.';
  END IF;
END;
$nexus$;

REVOKE ALL PRIVILEGES ON TABLE
  public.nexus_syllabus_requests,
  public.nexus_syllabus_votes
FROM anon, authenticated;

GRANT SELECT ON TABLE
  public.nexus_syllabus_requests,
  public.nexus_syllabus_votes
TO anon;

GRANT SELECT, INSERT, DELETE ON TABLE
  public.nexus_syllabus_requests,
  public.nexus_syllabus_votes
TO authenticated;

-- Verify the exact effective table privileges before committing. Any mismatch aborts
-- the transaction, leaving the existing grants unchanged.
DO $verify$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'public.nexus_syllabus_requests',
    'public.nexus_syllabus_votes'
  ] LOOP
    IF NOT has_table_privilege('anon', t, 'SELECT')
       OR has_table_privilege('anon', t, 'INSERT')
       OR has_table_privilege('anon', t, 'UPDATE')
       OR has_table_privilege('anon', t, 'DELETE')
       OR has_table_privilege('anon', t, 'TRUNCATE')
       OR has_table_privilege('anon', t, 'REFERENCES')
       OR has_table_privilege('anon', t, 'TRIGGER') THEN
      RAISE EXCEPTION 'Unexpected anon privileges remain on %; transaction aborted.', t;
    END IF;

    IF NOT has_table_privilege('authenticated', t, 'SELECT')
       OR NOT has_table_privilege('authenticated', t, 'INSERT')
       OR NOT has_table_privilege('authenticated', t, 'DELETE')
       OR has_table_privilege('authenticated', t, 'UPDATE')
       OR has_table_privilege('authenticated', t, 'TRUNCATE')
       OR has_table_privilege('authenticated', t, 'REFERENCES')
       OR has_table_privilege('authenticated', t, 'TRIGGER') THEN
      RAISE EXCEPTION 'Unexpected authenticated privileges remain on %; transaction aborted.', t;
    END IF;
  END LOOP;
END;
$verify$;

COMMIT;

-- Verify the resulting grants after running this script:
SELECT
  grantee,
  table_name,
  privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name IN (
    'nexus_syllabus_requests',
    'nexus_syllabus_votes'
  )
  AND grantee IN ('anon', 'authenticated')
ORDER BY table_name, grantee, privilege_type;
