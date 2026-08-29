-- What the office took off a proposal after it went out.
--
-- A client rings and says the back bed is out of budget. The proposal is
-- trimmed in place, on the same token, so their existing link shows the
-- shorter version — and that is exactly why this table exists. Without it,
-- the only record of what was dropped is the difference between a snapshot
-- we overwrote and one nobody kept, which is to say no record at all.
--
-- Deliberately append-only in practice: one row per trim, holding what came
-- off and what the price did, so "why is this five hundred cheaper than the
-- quote I remember" has an answer with a name and a date on it.

create table if not exists proposal_edits (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references job_proposals(id) on delete cascade,
  organization_id uuid not null references organizations(id),
  -- Who did it. Null only if the profile is later deleted.
  edited_by uuid references profiles(id) on delete set null,
  edited_by_name text,
  -- [{ zoneName, serviceLabel, priceCents }, ...]
  removed_zones jsonb not null default '[]',
  -- [{ zoneName, line }, ...]
  removed_lines jsonb not null default '[]',
  previous_total_cents integer,
  new_total_cents integer,
  -- Why, in the office's own words. Optional; the removals usually say it.
  note text,
  created_at timestamptz not null default now()
);

create index if not exists proposal_edits_proposal_idx on proposal_edits (proposal_id, created_at desc);

alter table proposal_edits enable row level security;
drop policy if exists "org_scoped_proposal_edits" on proposal_edits;
create policy "org_scoped_proposal_edits" on proposal_edits for all to authenticated
  using (organization_id = current_org_id())
  with check (organization_id = current_org_id());

notify pgrst, 'reload schema';
