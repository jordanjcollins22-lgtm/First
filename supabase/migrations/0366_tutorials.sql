-- Which first-open tutorial each person has been through. One row per person
-- per tour; a new version of a tour has a new id, so it shows again once.
create table if not exists public.tutorial_progress (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  tour text not null,
  completed_at timestamptz not null default now(),
  primary key (profile_id, tour)
);
alter table public.tutorial_progress enable row level security;
create policy tutorial_progress_own on public.tutorial_progress
  for all to authenticated
  using (profile_id = (select auth.uid()))
  with check (profile_id = (select auth.uid()));
