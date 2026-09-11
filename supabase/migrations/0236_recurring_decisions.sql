-- What somebody decided about a recurring charge.
--
-- The charges themselves are never stored. They are worked out from the
-- transactions every time the screen is opened, so a subscription cancelled in
-- March drops off by itself -- which a saved list would not do, and a saved
-- list of subscriptions quietly out of date is worse than no list, because it
-- gets trusted.
--
-- What cannot be worked out is judgement. Whether the fortnightly charge at
-- the bistro is a business expense or lunch, what a merchant is actually
-- called, and whether somebody has already looked at this one and decided to
-- keep it. That is what this table holds: one row per merchant, and only where
-- a person has said something.
create table if not exists recurring_decisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,

  -- The normalised merchant, which is what the detector groups by. Stable
  -- across runs, which is the whole point: a decision has to still apply next
  -- month.
  merchant_key text not null,

  -- What to call it, when the bank's description is unreadable.
  label text,
  -- Overrides what the detector worked out. Null means it got it right.
  kind text check (kind is null or kind in ('subscription', 'obligation', 'transfer')),

  -- Ticked off by a person. The difference between "we found this" and "we
  -- know about this".
  confirmed_at timestamptz,
  -- Not an overhead: personal, one-off, or wrong. Stays off the total.
  dismissed_at timestamptz,
  -- Flagged to get rid of. The reason anybody reads this screen twice.
  cancel_wanted boolean not null default false,

  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (organization_id, merchant_key)
);

comment on table recurring_decisions is
  'One judgement about a recurring charge, keyed by merchant. The charges are derived from transactions every time; only the human decisions are kept.';

create index if not exists recurring_decisions_org_idx
  on recurring_decisions (organization_id, merchant_key);

alter table recurring_decisions enable row level security;

drop policy if exists recurring_decisions_own_org on recurring_decisions;
create policy recurring_decisions_own_org on recurring_decisions
  for all using (organization_id = current_org_id())
  with check (organization_id = current_org_id());

notify pgrst, 'reload schema';
