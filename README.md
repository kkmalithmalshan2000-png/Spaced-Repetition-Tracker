# Nexus: Spaced Repetition Tracker (Netlify bundle)

A mobile-friendly, offline-first study tracker packaged as an installable Progressive Web App (PWA). The bundle is static and does not need a build command. Optional cloud sync requires your own Supabase project.

## Deploy free with Netlify

1. Download and extract `nexus-netlify-bundle.zip`.
2. In Netlify, choose **Add new site → Deploy manually** (wording may vary).
3. Upload the extracted `nexus-netlify-bundle` folder, or drag its contents into the deploy drop zone. `index.html`, `manifest.webmanifest`, `sw.js`, icons, and `netlify.toml` must be at the published root.
4. Open the resulting HTTPS URL in Chrome on Android.
5. In Chrome's menu, choose **Install app** or **Add to Home screen**.

You can also deploy from GitHub by pushing these files to a repository and connecting that repository to Netlify with the publish directory set to `.` and no build command.

## Included features

- Existing tracker functionality: custom streams/subjects/topics, review ratings, custom due dates, review history, exams/countdowns, themes, undo, and CSV/JSON import/export.
- Daily study planner based on due/overdue topics, recent ratings, weakness, and a configurable time budget.
- Focus-session timer and logged study time; weekly review target and goals/milestones.
- 14-day due/exam calendar, backlog recovery, and workload balancing over a selected number of days.
- Final-revision mode that raises the priority of non-mastered topics.
- Subject-neutral theory recall log: choose your own method (blank-page recall, verbal explanation, written outline, calculation/formula derivation, timed response, etc.) and record recall quality and gaps. No built-in quizzes or flashcards are included.
- Estimated mastery and weak-topic detection; per-subject syllabus coverage using tracked topics and optional expected topic counts.
- Analytics including review activity, 12-week heatmap, rating trends, subject activity, study time, and streaks.
- Mistake/concept-gap journal, past-paper and mock-exam tracking, timed sections, calculation drills, theory-recall logs, score/error tracking, and weak-area notes.
- Global search, bulk topic rescheduling/archive actions, topic CSV import/template, and CSV exports for journal, papers, selected topics, and study time.
- Full JSON backup including Study Hub data, plus restore/merge options for transferring data between devices.
- Optional Supabase cloud sync with Google OAuth or email magic-link sign-in, manual restore, and automatic uploads after local changes.
- Installable PWA shell with service-worker caching for offline use after the first successful visit.

## Data, sync, and notification limits

- Data is stored locally in the browser profile on each device. Export full JSON backups regularly and store a copy somewhere safe.
- Cloud sync is optional. Create a Supabase project, configure Google and/or email sign-in, run the SQL below, then enter the project URL and public anon key in Setup & data → Cloud sync. Never put a service_role key in the app.
- In Supabase → Authentication → URL Configuration, add your deployed app URL to the allowed redirect URLs. In Authentication → Providers, enable Google and configure its OAuth client. Email sign-in uses a magic link.
- Browser notifications can be checked while the app is open and permission is granted. Reliable scheduled push notifications while the browser is fully closed require push infrastructure and a server.
- The app includes the FSRS-6 scheduler in fsrs-bundle.js; this update leaves the scheduler bundle and its integration unchanged.
- The syllabus coverage percentage reflects topics you have entered, or your optional expected topic count; it cannot independently know the complete official syllabus.

## Updating an existing deployment

Deploy the entire bundle, not only `index.html`. Keep the same Netlify site/domain when possible so the browser origin and its locally stored data remain the same. Before changing domains or replacing devices, download a full JSON backup and restore it on the new site/device.


## Cloud sync setup

Cloud sync uses one row per authenticated user and relies on Row Level Security (RLS). Run this SQL in the Supabase SQL Editor:

```sql
create table if not exists public.nexus_user_data (
  user_id uuid primary key references auth.users(id) on delete cascade,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.nexus_user_data enable row level security;
drop policy if exists "Users can read own Nexus backup" on public.nexus_user_data;
drop policy if exists "Users can insert own Nexus backup" on public.nexus_user_data;
drop policy if exists "Users can update own Nexus backup" on public.nexus_user_data;
create policy "Users can read own Nexus backup" on public.nexus_user_data for select using (auth.uid() = user_id);
create policy "Users can insert own Nexus backup" on public.nexus_user_data for insert with check (auth.uid() = user_id);
create policy "Users can update own Nexus backup" on public.nexus_user_data for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

If a cloud backup already exists at sign-in, Nexus asks you to type RESTORE or UPLOAD; cancel leaves both copies untouched. A newer remote backup is protected from silent overwrite. Restore cloud backup replaces this device’s local data after confirmation. Keep JSON backups as an independent recovery option.
