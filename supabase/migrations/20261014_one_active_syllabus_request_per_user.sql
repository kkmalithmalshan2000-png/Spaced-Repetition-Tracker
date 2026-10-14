-- Enforce one active syllabus request per authenticated user.
-- Requests are physically deleted by their owner or the admin, so deletion
-- releases the unique owner_id slot and allows that user to submit again.
-- Existing duplicate owner_id rows must be resolved before this migration can apply.
create unique index if not exists nexus_syllabus_requests_one_active_per_owner
  on public.nexus_syllabus_requests (owner_id)
  where owner_id is not null;
