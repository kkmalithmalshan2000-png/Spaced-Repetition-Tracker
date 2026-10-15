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
