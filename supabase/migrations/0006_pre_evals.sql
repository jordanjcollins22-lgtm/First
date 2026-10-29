-- ============================================================
-- Client pre-evaluation (/pre-eval/<id>).
--
-- Clients who already booked an evaluation get a link to a satellite view of
-- their own property and tap the spots they want worked on. One row per job;
-- the row id is the unguessable token in the link, so the page needs no login.
-- ============================================================

create table if not exists pre_evals (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null unique references jobs(id) on delete cascade,
  -- [[lng, lat], ...] in the order the client tapped them.
  taps jsonb not null default '[]',
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table pre_evals enable row level security;

-- Estimators (signed in) read pre-evals and create links like every other
-- table. The public page reads and writes through the service-role key.
drop policy if exists "authenticated_full_access" on pre_evals;
create policy "authenticated_full_access" on pre_evals
  for all to authenticated using (true) with check (true);
