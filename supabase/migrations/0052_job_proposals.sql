-- Client-facing proposals, generated from a job's site map (canvas design).
-- Price and scope are snapshotted at generate time — once a client has a
-- link in hand, it shouldn't silently change if pricing/materials are
-- edited later. Regenerating overwrites the snapshot (same token, so an
-- already-shared link keeps working) unless the client has already
-- responded, which a team member has to explicitly do again on purpose.
--
-- Public access (the client viewing/responding via /proposal/[token]) goes
-- through the service-role client, same pattern as the GHL webhook and the
-- public booking flow — no anon RLS policy needed.

create table if not exists job_proposals (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade unique,
  organization_id uuid not null references organizations(id),
  token text not null unique,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  total_cost numeric,
  -- [{ zoneName, serviceLabel, scopeText, photoPaths: string[] }, ...]
  scope_snapshot jsonb not null default '[]',
  site_image_path text,
  generated_at timestamptz not null default now(),
  responded_at timestamptz,
  client_response_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_updated_at on job_proposals;
create trigger set_updated_at before update on job_proposals for each row execute function set_updated_at();

alter table job_proposals enable row level security;
drop policy if exists "org_scoped_job_proposals" on job_proposals;
create policy "org_scoped_job_proposals" on job_proposals for all to authenticated
  using (organization_id = current_org_id())
  with check (organization_id = current_org_id());
