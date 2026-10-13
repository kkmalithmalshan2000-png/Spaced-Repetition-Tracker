-- Nexus Community Syllabus Wishlist
-- Run once in Supabase Dashboard -> SQL Editor for project txugbdavblpettcnhcxl.
create extension if not exists pgcrypto;

create table if not exists public.nexus_syllabus_requests (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  category text not null check (char_length(category) between 1 and 100),
  topics text not null default '' check (char_length(topics) <= 3000),
  owner_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.nexus_syllabus_votes (
  request_id uuid not null references public.nexus_syllabus_requests(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (request_id, user_id)
);

create index if not exists nexus_syllabus_requests_created_at_idx
  on public.nexus_syllabus_requests (created_at desc);
create index if not exists nexus_syllabus_votes_request_id_idx
  on public.nexus_syllabus_votes (request_id);

alter table public.nexus_syllabus_requests enable row level security;
alter table public.nexus_syllabus_votes enable row level security;

drop policy if exists "Anyone can read syllabus requests" on public.nexus_syllabus_requests;
create policy "Anyone can read syllabus requests"
  on public.nexus_syllabus_requests for select to anon, authenticated using (true);
drop policy if exists "Signed-in users can create syllabus requests" on public.nexus_syllabus_requests;
create policy "Signed-in users can create syllabus requests"
  on public.nexus_syllabus_requests for insert to authenticated
  with check (auth.uid() = owner_id);
drop policy if exists "Owners can delete their own syllabus requests" on public.nexus_syllabus_requests;
create policy "Owners can delete their own syllabus requests"
  on public.nexus_syllabus_requests for delete to authenticated
  using (auth.uid() = owner_id);

drop policy if exists "Anyone can read syllabus votes" on public.nexus_syllabus_votes;
create policy "Anyone can read syllabus votes"
  on public.nexus_syllabus_votes for select to anon, authenticated using (true);
drop policy if exists "Signed-in users can upvote as themselves" on public.nexus_syllabus_votes;
create policy "Signed-in users can upvote as themselves"
  on public.nexus_syllabus_votes for insert to authenticated
  with check (auth.uid() = user_id);
drop policy if exists "Users can remove their own upvotes" on public.nexus_syllabus_votes;
create policy "Users can remove their own upvotes"
  on public.nexus_syllabus_votes for delete to authenticated
  using (auth.uid() = user_id);

grant select on public.nexus_syllabus_requests to anon, authenticated;
grant insert, delete on public.nexus_syllabus_requests to authenticated;
grant select on public.nexus_syllabus_votes to anon, authenticated;
grant insert, delete on public.nexus_syllabus_votes to authenticated;
