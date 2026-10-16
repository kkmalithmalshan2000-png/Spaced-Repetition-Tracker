-- Nexus Community Wishlist: revoke direct access to individual voter identities.
-- IMPORTANT: apply only AFTER the updated API is deployed to Production.
-- Apply the additive 20261016_hide_syllabus_vote_identities.sql migration first.
-- This migration removes direct vote-table SELECT while keeping aggregate counts and
-- the signed-in user's own vote state available through the restricted RPC functions.

BEGIN;

DO $nexus$
BEGIN
  IF to_regclass('public.nexus_syllabus_votes') IS NULL THEN
    RAISE EXCEPTION 'Nexus vote table is missing; no changes applied.';
  END IF;
  IF to_regprocedure('public.get_nexus_syllabus_vote_counts()') IS NULL
     OR to_regprocedure('public.get_my_nexus_syllabus_votes()') IS NULL
     OR to_regprocedure('public.set_nexus_syllabus_vote(uuid,boolean)') IS NULL THEN
    RAISE EXCEPTION 'Vote RPC functions are missing; apply the additive migration first.';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass('public.nexus_syllabus_votes')) THEN
    RAISE EXCEPTION 'RLS must be enabled on the Nexus vote table before revoking direct access.';
  END IF;
END;
$nexus$;

DROP POLICY IF EXISTS "Anyone can read syllabus votes" ON public.nexus_syllabus_votes;
REVOKE ALL PRIVILEGES ON TABLE public.nexus_syllabus_votes FROM PUBLIC, anon, authenticated;
GRANT INSERT, DELETE ON TABLE public.nexus_syllabus_votes TO authenticated;

COMMIT;

-- Verification: this query should return no rows for anon/authenticated SELECT on votes.
SELECT grantee, table_name, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name = 'nexus_syllabus_votes'
  AND grantee IN ('anon', 'authenticated')
ORDER BY grantee, privilege_type;
