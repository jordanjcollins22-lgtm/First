-- Two things the business could not do yet:
--
--  1. Cancel an estimate. Job status already had 'cancelled'; evaluation
--     status did not, so a visit that fell through had to be faked as
--     "completed" or left sitting on the calendar forever.
--  2. Record money that doesn't flow through Stripe or payroll — a cash job,
--     a check, a materials run, a subcontractor. That is most of the money in
--     a landscaping business, and none of it was on the books.

-- ---------------------------------------------------------------------------
-- 1. Cancelling
-- ---------------------------------------------------------------------------

alter table jobs drop constraint if exists jobs_evaluation_status_check;
alter table jobs add constraint jobs_evaluation_status_check
  check (evaluation_status = any (array['scheduled', 'on_way', 'arrived', 'completed', 'cancelled']));

-- Why a job or estimate was cancelled, kept on the row so the reason survives
-- a later reinstatement and shows up in the history rather than vanishing.
alter table jobs add column if not exists cancelled_at timestamptz;
alter table jobs add column if not exists cancellation_reason text;

-- ---------------------------------------------------------------------------
-- 2. The ledger
-- ---------------------------------------------------------------------------

-- One table for both directions rather than two near-identical ones: every
-- row is money moving, and the only real difference is the sign. Reporting
-- "in minus out" over one table is a single query instead of a union.
--
-- Deliberately NOT the home for Stripe invoices or team payments — those have
-- their own tables with their own lifecycles. This is everything else, which
-- for this business is most of it.
create table if not exists ledger_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),

  direction text not null check (direction in ('in', 'out')),
  category text not null check (category in (
    -- in
    'job_payment', 'deposit', 'other_income',
    -- out
    'materials', 'subcontractor', 'fuel', 'equipment', 'permit', 'other_expense'
  )),

  amount numeric(12, 2) not null check (amount > 0),
  occurred_on date not null default current_date,
  method text check (method in ('cash', 'check', 'transfer', 'card', 'other')),

  -- Who it came from or went to. Free text because a supplier isn't a
  -- customer and doesn't deserve a row in the client book.
  party text,
  -- Optional link to the work it belongs to, so a job can show its own P&L.
  job_id uuid references jobs(id) on delete set null,

  note text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- 'in' categories and 'out' categories are not interchangeable; a row
  -- claiming to be income filed under 'fuel' is a data-entry mistake, not a
  -- valid record.
  constraint ledger_entries_direction_category check (
    (direction = 'in' and category in ('job_payment', 'deposit', 'other_income'))
    or (direction = 'out' and category in ('materials', 'subcontractor', 'fuel', 'equipment', 'permit', 'other_expense'))
  )
);

create index if not exists ledger_entries_org_date_idx
  on ledger_entries(organization_id, occurred_on desc);
create index if not exists ledger_entries_org_direction_idx
  on ledger_entries(organization_id, direction);
create index if not exists ledger_entries_job_idx
  on ledger_entries(job_id) where job_id is not null;

drop trigger if exists set_updated_at on ledger_entries;
create trigger set_updated_at before update on ledger_entries
  for each row execute function set_updated_at();

alter table ledger_entries enable row level security;

-- Same audience as team_payments: this is the whole financial picture of the
-- business, so it stays with the people who can already see pay and costs.
drop policy if exists "money_people_manage_ledger" on ledger_entries;
create policy "money_people_manage_ledger" on ledger_entries for all to authenticated
  using (
    organization_id = current_org_id()
    and exists (
      select 1 from profile_roles pr
      where pr.profile_id = auth.uid() and pr.role_name in ('admin', 'overhead', 'owner')
    )
  )
  with check (
    organization_id = current_org_id()
    and exists (
      select 1 from profile_roles pr
      where pr.profile_id = auth.uid() and pr.role_name in ('admin', 'overhead', 'owner')
    )
  );

notify pgrst, 'reload schema';
