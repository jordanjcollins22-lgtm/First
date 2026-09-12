-- What clients ask before they say yes, and what happened next.
--
-- A proposal that goes quiet tells you nothing. A proposal where somebody
-- tapped "the price is more than I expected", read the answer, and then asked
-- to drop the back fence tells you what the objection was, whether the stock
-- answer worked, and what it cost to win the job. That is the difference
-- between guessing at a close rate and knowing where quotes actually stall.
--
-- Every row is a thing a client did at a moment. None of it is derived, and
-- none of it gets edited afterwards.

create table if not exists proposal_objections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  proposal_id uuid not null references job_proposals(id) on delete cascade,

  -- The catalogue id ('price_high', 'cannot_pay_at_once'…), or 'other' when
  -- the client had something we had no answer for. Deliberately text and not
  -- a foreign key: the catalogue lives in code, and a row recording what
  -- somebody asked in March should survive us rewording the question in May.
  objection_id text not null,

  -- Free text, and only reachable once a stock answer has been read and
  -- rejected. A row with this set is the queue of objections we cannot yet
  -- handle — which is the list worth reading every month.
  note text,

  -- What we offered, and what they took: 'explain', 'payment_plan',
  -- 'reduce_scope', 'talk', or null when they only read the answer.
  resolution text check (
    resolution is null or resolution in ('explain', 'payment_plan', 'reduce_scope', 'talk')
  ),

  -- Did the stock answer settle it. Null while they are still reading.
  resolved boolean,

  raised_at timestamptz not null default now()
);

create index if not exists proposal_objections_proposal_idx
  on proposal_objections(proposal_id, raised_at desc);
-- The month-end question: what are people asking that we have no answer for.
create index if not exists proposal_objections_unresolved_idx
  on proposal_objections(organization_id, raised_at desc) where resolved is false;

alter table proposal_objections enable row level security;
drop policy if exists "org_scoped_proposal_objections" on proposal_objections;
create policy "org_scoped_proposal_objections" on proposal_objections for all to authenticated
  using (organization_id = current_org_id())
  with check (organization_id = current_org_id());

-- ---------------------------------------------------------------------------
-- Asking to keep only part of the work
-- ---------------------------------------------------------------------------
-- Kept apart from the objection that prompted it, because it outlives it: a
-- client can trim the scope without ever having pressed an objection, and the
-- office needs to find the request either way.
--
-- 'applied' means the price re-derived cleanly and the proposal already says
-- the new number. 'needs_review' means it did not — a hand-entered line, a
-- discount, a line with no price — and a person has to answer. The client is
-- told which, because a quote that silently changes is worse than one that
-- takes a day.
create table if not exists proposal_scope_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  proposal_id uuid not null references job_proposals(id) on delete cascade,

  -- Zone names, snapshotted. Not ids: the proposal's scope is itself a
  -- snapshot, and the zones on the live canvas may have been renamed or
  -- deleted since it was sent.
  kept_zones text[] not null default '{}',
  dropped_zones text[] not null default '{}',

  -- Cents. The price before and the price after, so the office can see what
  -- the trim cost without recomputing anything.
  previous_total_cents bigint,
  new_total_cents bigint,

  status text not null default 'needs_review'
    check (status in ('applied', 'needs_review', 'accepted', 'rejected')),
  review_reason text,

  requested_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references profiles(id)
);

create index if not exists proposal_scope_requests_proposal_idx
  on proposal_scope_requests(proposal_id, requested_at desc);
-- The work list: what a person still has to answer.
create index if not exists proposal_scope_requests_open_idx
  on proposal_scope_requests(organization_id, requested_at desc) where status = 'needs_review';

alter table proposal_scope_requests enable row level security;
drop policy if exists "org_scoped_proposal_scope_requests" on proposal_scope_requests;
create policy "org_scoped_proposal_scope_requests" on proposal_scope_requests for all to authenticated
  using (organization_id = current_org_id())
  with check (organization_id = current_org_id());

notify pgrst, 'reload schema';
