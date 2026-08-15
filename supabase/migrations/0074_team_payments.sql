-- What we've actually paid each team member, and what's still owed.
--
-- Deliberately a ledger, not a payroll engine: a row is one payment to one
-- person, entered by whoever handles the money. It records payments made
-- elsewhere (cash, check, bank transfer) rather than moving money itself.
--
-- Pay *rates* already live on the profile (pay_type, pay_rate_per_hour,
-- commission_pct). Those say what someone earns; this says what they've been
-- handed. Keeping them apart means changing a rate never rewrites history.

create table if not exists team_payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  profile_id uuid not null references profiles(id) on delete restrict,
  amount numeric(12, 2) not null check (amount > 0),
  -- 'pending' is money owed but not yet handed over; 'paid' is settled.
  status text not null default 'pending' check (status in ('pending', 'paid')),
  method text check (method in ('cash', 'check', 'transfer', 'other')),
  -- Optional: what stretch of work this covers, for a weekly/biweekly run.
  period_start date,
  period_end date,
  hours numeric(8, 2) check (hours >= 0),
  paid_at date,
  note text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint team_payments_period_order check (
    period_start is null or period_end is null or period_end >= period_start
  )
);

create index if not exists team_payments_org_profile_idx
  on team_payments(organization_id, profile_id);
create index if not exists team_payments_org_status_idx
  on team_payments(organization_id, status);

drop trigger if exists set_updated_at on team_payments;
create trigger set_updated_at before update on team_payments
  for each row execute function set_updated_at();

alter table team_payments enable row level security;

-- Payroll is not org-wide reading like tools or overhead: a crew member can
-- see their own payments and nobody else's. Only the money roles see everyone,
-- and only they can write — otherwise anyone could pay themselves on paper.
drop policy if exists "payroll_scoped_team_payments_read" on team_payments;
create policy "payroll_scoped_team_payments_read" on team_payments for select to authenticated
  using (
    organization_id = current_org_id()
    and (
      profile_id = auth.uid()
      or exists (
        select 1 from profile_roles pr
        where pr.profile_id = auth.uid() and pr.role_name in ('admin', 'overhead', 'owner')
      )
    )
  );

drop policy if exists "payroll_scoped_team_payments_write" on team_payments;
create policy "payroll_scoped_team_payments_write" on team_payments for all to authenticated
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
