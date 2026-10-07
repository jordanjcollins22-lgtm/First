-- The client approves the before and afters, and the job closes after that.
--
-- The account manager walks the finished job, takes the final afters and
-- sends the client the befores and afters side by side. The client approves
-- them from their phone, or says what is not right. Only once they have
-- approved does the manager approve and the job get signed off: a job is
-- done when the client is happy, not when the crew packs up.
--
-- One row per time it was sent, so a job sent back for a touch-up and sent
-- again keeps both answers. The newest row is the one that counts.
create table if not exists job_client_reviews (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  job_id uuid not null references jobs(id) on delete cascade,
  -- The whole of the client's access: they have no account.
  token text not null unique default replace(gen_random_uuid()::text, '-', ''),
  status text not null default 'sent' check (status in ('sent', 'approved', 'changes')),
  sent_to text,
  sent_by uuid references profiles(id) on delete set null,
  sent_at timestamptz not null default now(),
  responded_at timestamptz,
  -- What they said was not right, in their words.
  client_note text,
  -- Approved face to face on the walkthrough, recorded by whoever was there.
  recorded_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists job_client_reviews_job_idx on job_client_reviews (job_id, created_at desc);

alter table job_client_reviews enable row level security;

drop policy if exists job_client_reviews_own_org on job_client_reviews;
create policy job_client_reviews_own_org on job_client_reviews
  for all using (organization_id = (select current_org_id()))
  with check (organization_id = (select current_org_id()));

-- When the site map was submitted. The evaluation status says whether; this
-- says when, for the project's timeline.
alter table jobs add column if not exists evaluation_submitted_at timestamptz;

-- Jobs already submitted: the proposal is built the moment the map is
-- submitted, so its first build is the nearest record of when.
update jobs j
set evaluation_submitted_at = p.first_built
from (
  select job_id, min(coalesce(generated_at, created_at)) as first_built
  from job_proposals
  group by job_id
) p
where p.job_id = j.id
  and j.evaluation_status = 'completed'
  and j.evaluation_submitted_at is null;
