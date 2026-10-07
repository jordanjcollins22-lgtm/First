-- People who want to watch a project without being the client.
--
-- A property manager, a management company, a spouse who is not on the
-- paperwork, a landlord — somebody who needs to see how the work is going and
-- has no business seeing what it costs or being asked to approve it.
--
-- Deliberately not customers and deliberately not accounts. Making them a
-- customer would put them in every contact picker and every count of "our
-- clients"; making them a user would mean an invite, a password, and a login
-- for somebody who wants to look at a page twice. So this is a link, like the
-- proposal, and the link is the whole of their access.

create table if not exists job_observers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  job_id uuid not null references jobs(id) on delete cascade,

  name text not null,
  -- How to reach them, for whoever is sending the link. Neither is required:
  -- the office often has one and not the other, and refusing to record a
  -- watcher over a missing email helps nobody.
  email text,
  phone text,

  -- What they are to this job, in the words somebody would use out loud.
  relationship text not null default 'other'
    check (relationship in ('property_manager', 'management_company', 'family', 'tenant', 'landlord', 'other')),

  -- Their whole access. Same shape as the proposal token.
  token text not null unique,

  -- Revoked rather than deleted, so a link that stops working leaves a record
  -- of who had it and when it was turned off.
  revoked_at timestamptz,
  last_viewed_at timestamptz,

  added_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- One row per person per job. Adding somebody twice updates rather than
  -- handing out a second link nobody can account for.
  unique (job_id, token)
);

create index if not exists job_observers_job_idx on job_observers(job_id);
create index if not exists job_observers_token_idx on job_observers(token);

drop trigger if exists set_updated_at on job_observers;
create trigger set_updated_at before update on job_observers
  for each row execute function set_updated_at();

alter table job_observers enable row level security;

-- The office manages the list. The watcher never authenticates at all — their
-- page is read through the service role by token, exactly like the proposal.
drop policy if exists "org_scoped_job_observers" on job_observers;
create policy "org_scoped_job_observers" on job_observers for all to authenticated
  using (organization_id = current_org_id())
  with check (organization_id = current_org_id());

notify pgrst, 'reload schema';
