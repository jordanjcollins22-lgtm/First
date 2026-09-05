-- Two conversation threads per job: "internal" (team-only, never shown to
-- the client) and "external" (visible on the job page to the team AND on
-- the public proposal page to the client — a real back-and-forth, not just
-- the one-time decline note job_proposals already has).
--
-- Client messages come in through the service-role client (no logged-in
-- user), same pattern as the rest of the public proposal/booking flows.

create table if not exists job_messages (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  organization_id uuid not null references organizations(id),
  channel text not null check (channel in ('internal', 'external')),
  author_type text not null check (author_type in ('team', 'client')),
  author_profile_id uuid references profiles(id),
  author_name text not null,
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists job_messages_job_id_idx on job_messages (job_id, channel, created_at);

alter table job_messages enable row level security;
drop policy if exists "org_scoped_job_messages" on job_messages;
create policy "org_scoped_job_messages" on job_messages for all to authenticated
  using (organization_id = current_org_id())
  with check (organization_id = current_org_id());
