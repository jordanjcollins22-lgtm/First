-- Payments to team members. Applied directly to the database before this
-- file existed, so this is written to match what's already there exactly —
-- every statement is idempotent and re-running it is a no-op.
--
-- Read access is deliberately wider than write: you can always see your own
-- payments, but only admin/overhead/owner can see everyone's or record one.

create table if not exists team_payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  profile_id uuid not null references profiles(id) on delete restrict,
  amount numeric(12, 2) not null check (amount > 0),
  status text not null default 'pending' check (status in ('pending', 'paid')),
  method text check (method in ('cash', 'check', 'transfer', 'other')),
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
