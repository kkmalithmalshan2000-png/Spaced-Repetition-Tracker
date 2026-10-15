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
