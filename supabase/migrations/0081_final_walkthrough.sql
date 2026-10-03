-- The account manager walks the job before the crew packs up.
--
-- Sign-off was the crew's own call, which means the first person to find a
-- problem was the client. Going back for a snag costs a trip; catching it
-- while the tools are still out costs ten minutes. So there is now a step
-- between "we think we're done" and "we're done": somebody who did not do the
-- work has to stand on the site and say so.
--
-- Deliberately a table rather than a column pair. A walkthrough that fails
-- happens again after the fix, and the interesting record is the sequence —
-- what was wrong the first time, and whether it was right the second.

create table if not exists job_walkthroughs (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  organization_id uuid not null references organizations(id),

  -- Raised by the crew from site. The whole point is that this happens while
  -- they are still standing there.
  requested_by uuid references profiles(id),
  requested_at timestamptz not null default now(),
  -- Where the crew was when they asked, so "he never came out" and "they'd
  -- already left" stop being the same conversation.
  requested_note text,

  status text not null default 'requested'
    check (status in ('requested', 'approved', 'rejected', 'cancelled')),

  reviewed_by uuid references profiles(id),
  reviewed_at timestamptz,
  -- What the manager saw. On a rejection this is the punch list.
  review_notes text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- A decision without a decider is not a decision.
  constraint job_walkthroughs_decided check (
    status in ('requested', 'cancelled')
    or (reviewed_by is not null and reviewed_at is not null)
  )
);

create index if not exists job_walkthroughs_job_idx
  on job_walkthroughs(job_id, requested_at desc);
-- Drives the "waiting on you" queue, so it stays cheap as history builds up.
create index if not exists job_walkthroughs_pending_idx
  on job_walkthroughs(organization_id, status) where status = 'requested';

drop trigger if exists set_updated_at on job_walkthroughs;
create trigger set_updated_at before update on job_walkthroughs
  for each row execute function set_updated_at();

alter table job_walkthroughs enable row level security;

-- Same audience as the job. The crew raise it, the manager decides it, and
-- both need to see it; narrowing writes to managers would stop the crew
-- asking, which is the half that matters most.
drop policy if exists "org_scoped_job_walkthroughs" on job_walkthroughs;
create policy "org_scoped_job_walkthroughs" on job_walkthroughs for all to authenticated
  using (
    organization_id = current_org_id()
    and exists (
      select 1 from jobs j
      join properties p on p.id = j.property_id
      join customers c on c.id = p.customer_id
      where j.id = job_walkthroughs.job_id and c.organization_id = current_org_id()
    )
  )
  with check (
    organization_id = current_org_id()
    and exists (
      select 1 from jobs j
      join properties p on p.id = j.property_id
      join customers c on c.id = p.customer_id
      where j.id = job_walkthroughs.job_id and c.organization_id = current_org_id()
    )
  );

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- Being told about it
-- ---------------------------------------------------------------------------

-- Defaults on, unlike most notification kinds. A walkthrough request is
-- somebody standing on a site waiting for you; a manager who silently never
-- opted in is the failure mode this whole feature exists to prevent.
alter table notification_preferences
  add column if not exists walkthrough_requests boolean not null default true;

notify pgrst, 'reload schema';
