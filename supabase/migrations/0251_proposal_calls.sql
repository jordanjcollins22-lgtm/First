-- What the client said when we rang about their proposal.
--
-- A proposal sent and not answered, or answered no, is the most valuable
-- thing in the business nobody had a list of. The account manager needs to
-- ring them, and what came back on that call needs to be one tap and a line
-- of notes, kept against the proposal so the next call starts where the
-- last one ended.
create table if not exists proposal_calls (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  proposal_id uuid not null references job_proposals(id) on delete cascade,
  job_id uuid not null references jobs(id) on delete cascade,
  customer_id uuid references customers(id) on delete set null,
  profile_id uuid references profiles(id) on delete set null,
  outcome text not null check (outcome in (
    'no_answer', 'call_back', 'thinking', 'too_expensive', 'wants_changes',
    'next_season', 'went_elsewhere', 'said_yes', 'do_not_call'
  )),
  note text,
  -- When to ring again. Set by "call back" and "next season", and by "no
  -- answer" a couple of days on.
  callback_on date,
  created_at timestamptz not null default now()
);

comment on table proposal_calls is
  'One row per call about a proposal: what the client said, in one tap and a line, and when to ring again.';

create index if not exists proposal_calls_proposal_idx on proposal_calls (proposal_id, created_at desc);
create index if not exists proposal_calls_org_idx on proposal_calls (organization_id, created_at desc);

alter table proposal_calls enable row level security;
drop policy if exists "org_scoped_proposal_calls" on proposal_calls;
create policy "org_scoped_proposal_calls" on proposal_calls for all to authenticated
  using (organization_id = current_org_id())
  with check (organization_id = current_org_id());

notify pgrst, 'reload schema';
