-- What a client actually read, and what they pressed.
--
-- The view log already answers "did they open it" and "how many times". What
-- it cannot answer is what happened inside the open, and that is where the
-- useful part is. Somebody who spent ninety seconds on the price and four on
-- the scope has a different objection from somebody who read the fence area
-- three times and never scrolled to the total, and the call that follows
-- should not be the same call.
--
-- Two kinds of row, because they mean different things. A section row is how
-- long that part of the page was actually on screen, which has to be measured
-- rather than guessed from scroll position: a page flicked through in one
-- movement has technically shown everything. A click row is a decision, and
-- "Ask about this" on one area is the most informative thing a client can do
-- short of replying, because it names the part they are unsure about without
-- them having to write anything.
--
-- What is deliberately not collected: anything identifying. A visit carries
-- the same salted, per proposal hash the view log uses, so two people in one
-- household can be told apart on one proposal and the same person cannot be
-- followed between two. No cursor tracking, no scroll recording, no session
-- replay. The question is "which part of this quote are they stuck on", and
-- none of that is needed to answer it.
create table if not exists proposal_events (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references job_proposals(id) on delete cascade,

  kind text not null check (kind in ('section', 'click')),

  -- A stable key for the thing. A section name, or a zone's own name.
  target text not null,
  -- What to call it on screen, where the key is not readable on its own.
  label text,

  -- Seconds on screen. Always zero on a click.
  seconds numeric not null default 0 check (seconds >= 0),

  at timestamptz not null default now(),

  -- Who, roughly, and only within this one proposal. Same construction as
  -- proposal_views: a hash of address and browser salted with the proposal's
  -- own id.
  visitor_hash text,

  created_at timestamptz not null default now()
);

comment on table proposal_events is
  'What a client read and pressed inside one proposal. Internal only, never shown on the public page.';
comment on column proposal_events.seconds is
  'Measured on screen time, not time since open. A section scrolled past scores near zero on purpose.';

-- The only query this table has: one proposal's events, oldest first.
create index if not exists proposal_events_proposal_idx
  on proposal_events (proposal_id, at);

alter table proposal_events enable row level security;

-- Readable by the office, scoped through the proposal it belongs to. Nothing
-- here is written by a signed-in user: the client has no account, so the
-- insert goes through the service role like the rest of the public path.
drop policy if exists "org_scoped_proposal_events" on proposal_events;
create policy "org_scoped_proposal_events" on proposal_events for all to authenticated
  using (
    exists (
      select 1 from job_proposals p
      where p.id = proposal_events.proposal_id and p.organization_id = current_org_id()
    )
  )
  with check (
    exists (
      select 1 from job_proposals p
      where p.id = proposal_events.proposal_id and p.organization_id = current_org_id()
    )
  );

notify pgrst, 'reload schema';
