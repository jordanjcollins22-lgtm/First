-- "We're done here — can we start the next one?"
--
-- A crew that finishes at two has three hours of daylight and nothing to do
-- with them. The office finds out tomorrow. Meanwhile the customer booked for
-- Thursday would have taken Tuesday gladly, and nobody asked.
--
-- This is the asking. Deliberately a request and not a start: the account
-- manager owns what the customer is expecting, and a crew arriving two days
-- early unannounced is a complaint, not a favour.

create table if not exists early_start_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,

  job_id uuid not null references jobs(id) on delete cascade,
  -- The visit they want to pull forward. Cascades: a cancelled visit is not a
  -- decision anybody still needs to make.
  session_id uuid not null references job_work_sessions(id) on delete cascade,

  requested_by uuid not null references profiles(id) on delete cascade,
  -- The day they are asking to do it on, which is nearly always today. Stored
  -- rather than inferred from raised_at: somebody asking at half four for
  -- tomorrow morning is a different question from asking to start now.
  requested_for date not null,
  note text,

  status text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  decided_by uuid references profiles(id),
  decided_at timestamptz,
  decline_reason text,

  created_at timestamptz not null default now()
);

create index if not exists early_start_requests_session_idx
  on early_start_requests(session_id, created_at desc);
-- The account manager's queue.
create index if not exists early_start_requests_open_idx
  on early_start_requests(organization_id, requested_for) where status = 'pending';

-- One open ask per visit. Without this, a crew tapping twice on a slow
-- connection puts two identical questions in front of the account manager,
-- and answering one leaves the other sitting there.
create unique index if not exists early_start_requests_one_open_idx
  on early_start_requests(session_id) where status = 'pending';

alter table early_start_requests enable row level security;
drop policy if exists "org_scoped_early_start_requests" on early_start_requests;
create policy "org_scoped_early_start_requests" on early_start_requests for all to authenticated
  using (organization_id = current_org_id())
  with check (organization_id = current_org_id());

-- A channel of its own, rather than borrowing one.
--
-- Folding this into "walkthrough requests" would mean the settings screen
-- offers a toggle that silently governs something it does not name, and the
-- first person to switch walkthroughs off loses these without being told.
--
-- Defaults on, like walkthroughs and unlike the rest: this is a crew standing
-- in a finished garden waiting for an answer, and it goes stale within hours.
alter table notification_preferences
  add column if not exists schedule_requests boolean not null default true;

comment on column notification_preferences.schedule_requests is
  'Crew asking to pull a booked visit forward. Time-critical: the answer is worthless tomorrow.';

notify pgrst, 'reload schema';
