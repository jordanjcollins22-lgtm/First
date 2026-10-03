-- The evaluator's note, and the words we propose to send instead.
--
-- What an evaluator types on a driveway is for us: "client wants anything
-- drooping trimmed, dog dug up the mulch". It used to go into the proposal
-- word for word. Now it stays exactly as written, and beside it sits a
-- recommended scope of work for the client to read, which somebody in the
-- office approves or declines. A decline says why, and gets a fresh
-- recommendation to judge. Every round is kept.

create table if not exists scope_recommendations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  job_id uuid not null references jobs(id) on delete cascade,
  zone_index integer not null,
  zone_name text not null,
  round integer not null default 1,
  -- The evaluator's words, as they were when this was written. Never edited.
  evaluator_note text not null,
  recommended_text text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined', 'superseded')),
  decline_reason text,
  decided_by uuid references profiles(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists scope_recommendations_job_idx on scope_recommendations (job_id, zone_index, round desc);

alter table scope_recommendations enable row level security;
drop policy if exists "scope_recommendations_org" on scope_recommendations;
create policy "scope_recommendations_org" on scope_recommendations for all to authenticated
  using (organization_id = current_org_id())
  with check (organization_id = current_org_id());
