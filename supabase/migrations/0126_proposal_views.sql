-- Whether the client has actually opened their proposal.
--
-- "Sent" and "read" are different facts and the office only had the first
-- one. A proposal nobody has opened needs a nudge; one opened six times in
-- two days needs a phone call, not a nudge. Without this, both look
-- identical from the inside.
--
-- A row per view rather than a counter on the proposal, so the count, the
-- first open and the last open all come from the same place and cannot drift
-- apart. Counters also lose the shape of it: six opens in an hour is a
-- household deciding, six opens across three weeks is somebody stalling.

create table if not exists proposal_views (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references job_proposals(id) on delete cascade,

  viewed_at timestamptz not null default now(),

  -- Who, roughly, without keeping anything about them. A hash of the address
  -- and browser salted with the proposal's own id, so it separates the client
  -- from their spouse on the same page and cannot be lined up against the
  -- same person's visit to any other proposal.
  visitor_hash text,

  created_at timestamptz not null default now()
);

-- The only query this table has: one proposal's views, newest first.
create index if not exists proposal_views_proposal_idx
  on proposal_views(proposal_id, viewed_at desc);

-- Repeat visits inside the dedupe window are found by this before writing.
create index if not exists proposal_views_visitor_idx
  on proposal_views(proposal_id, visitor_hash, viewed_at desc);

alter table proposal_views enable row level security;

-- Readable by the office, scoped through the proposal it belongs to. Nothing
-- here is written by a signed-in user: the client has no account, so the
-- insert goes through the service role like the rest of the public proposal
-- path.
drop policy if exists "org_scoped_proposal_views" on proposal_views;
create policy "org_scoped_proposal_views" on proposal_views for all to authenticated
  using (
    exists (
      select 1 from job_proposals p
      where p.id = proposal_views.proposal_id and p.organization_id = current_org_id()
    )
  )
  with check (
    exists (
      select 1 from job_proposals p
      where p.id = proposal_views.proposal_id and p.organization_id = current_org_id()
    )
  );

comment on table proposal_views is
  'One row per time a client opened their proposal. Internal only — never shown on the public page.';

notify pgrst, 'reload schema';
