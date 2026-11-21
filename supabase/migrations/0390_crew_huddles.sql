-- The morning team huddle, one row per day.
--
-- Crews are trucks (Harrison's crew, Max's crew, Jordan's crew), and not every
-- technician leading a truck has a login yet, so the day's crews are kept as
-- the plan the morning crew texts were written from: a list of crews, each
-- with where they meet and their stops (a stop's job id opens its no-login
-- crew page). With no plan saved, the huddle page builds the crews from the
-- app's schedule instead.
--
-- goal, watch_outs, blockers and shout_out are what the owner or account
-- manager types on the huddle page itself.
create table if not exists public.crew_huddles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  day date not null,
  goal text,
  crews jsonb,
  watch_outs text,
  blockers text,
  shout_out text,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, day)
);

alter table public.crew_huddles enable row level security;

-- The business's own rows. Who may edit is checked by the app's action.
drop policy if exists crew_huddles_own_org on public.crew_huddles;
create policy crew_huddles_own_org on public.crew_huddles
  for all using (organization_id = current_org_id())
  with check (organization_id = current_org_id());

notify pgrst, 'reload schema';
