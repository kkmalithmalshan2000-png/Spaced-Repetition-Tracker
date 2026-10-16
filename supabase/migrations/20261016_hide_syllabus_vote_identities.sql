-- Nexus Community Wishlist: hide individual voter identities.
-- Apply this migration in the Supabase SQL Editor after reviewing it.
-- Vote totals remain publicly readable through a restricted aggregate function;
-- authenticated users can retrieve only their own vote IDs and mutate their own votes.

BEGIN;

DO $nexus$
BEGIN
  IF to_regclass('public.nexus_syllabus_requests') IS NULL
     OR to_regclass('public.nexus_syllabus_votes') IS NULL THEN
    RAISE EXCEPTION 'Nexus community tables are missing; no changes applied.';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass('public.nexus_syllabus_requests'))
     OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass('public.nexus_syllabus_votes')) THEN
    RAISE EXCEPTION 'RLS must be enabled on both Nexus community tables before applying this migration.';
  END IF;
END;
$nexus$;

DROP POLICY IF EXISTS "Anyone can read syllabus votes" ON public.nexus_syllabus_votes;
REVOKE ALL PRIVILEGES ON TABLE public.nexus_syllabus_votes FROM PUBLIC, anon, authenticated;
GRANT INSERT, DELETE ON TABLE public.nexus_syllabus_votes TO authenticated;

-- Vote identities are private. Public clients receive only aggregate totals;
-- signed-in clients can retrieve only their own vote IDs.
CREATE OR REPLACE FUNCTION public.get_nexus_syllabus_vote_counts()
RETURNS TABLE (request_id uuid, vote_count bigint)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT votes.request_id, pg_catalog.count(*)::bigint
  FROM public.nexus_syllabus_votes AS votes
  GROUP BY votes.request_id;
$function$;

CREATE OR REPLACE FUNCTION public.get_my_nexus_syllabus_votes()
RETURNS TABLE (request_id uuid)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT votes.request_id
  FROM public.nexus_syllabus_votes AS votes
  WHERE votes.user_id = auth.uid();
$function$;

CREATE OR REPLACE FUNCTION public.set_nexus_syllabus_vote(p_request_id uuid, p_upvote boolean)
RETURNS TABLE (changed boolean, vote_count bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_row_count integer := 0;
  v_changed boolean := false;
  v_vote_count bigint := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  IF p_upvote THEN
    INSERT INTO public.nexus_syllabus_votes (request_id, user_id)
    VALUES (p_request_id, v_user_id)
    ON CONFLICT (request_id, user_id) DO NOTHING;
    GET DIAGNOSTICS v_row_count = ROW_COUNT;
  ELSE
    DELETE FROM public.nexus_syllabus_votes
    WHERE request_id = p_request_id AND user_id = v_user_id;
    GET DIAGNOSTICS v_row_count = ROW_COUNT;
  END IF;

  v_changed := v_row_count > 0;
  SELECT pg_catalog.count(*) INTO v_vote_count
  FROM public.nexus_syllabus_votes AS votes
  WHERE votes.request_id = p_request_id;

  RETURN QUERY SELECT v_changed, v_vote_count;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_nexus_syllabus_vote_counts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_nexus_syllabus_vote_counts() TO anon, authenticated;
REVOKE ALL ON FUNCTION public.get_my_nexus_syllabus_votes() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_nexus_syllabus_votes() TO authenticated;
REVOKE ALL ON FUNCTION public.set_nexus_syllabus_vote(uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_nexus_syllabus_vote(uuid, boolean) TO authenticated;

COMMIT;
