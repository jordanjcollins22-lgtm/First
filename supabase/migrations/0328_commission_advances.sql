-- An account manager asking for part of a project's commission before it is
-- payable, on a project the client has paid in full. Asked for, approved or
-- declined by the owner, then paid; paying
-- it writes a commission payout against the project, so it comes off what
-- is owed on it when the commission is due.
create table if not exists public.commission_advances (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  amount numeric(12,2) not null check (amount > 0),
  reason text,
  status text not null default 'requested' check (status in ('requested', 'approved', 'declined', 'paid', 'cancelled')),
  requested_at timestamptz not null default now(),
  decided_by uuid references public.profiles(id) on delete set null,
  decided_at timestamptz,
  decision_note text,
  paid_at timestamptz,
  paid_by uuid references public.profiles(id) on delete set null,
  method text,
  reference text,
  payout_id uuid references public.commission_payouts(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists commission_advances_org_status_idx on public.commission_advances (organization_id, status);
create index if not exists commission_advances_profile_idx on public.commission_advances (profile_id);

alter table public.commission_advances enable row level security;

-- Same as the payouts: the business's own rows. Who may ask, approve and
-- pay is checked by the app's actions.
drop policy if exists commission_advances_own_org on public.commission_advances;
create policy commission_advances_own_org on public.commission_advances
  for all using (organization_id = current_org_id())
  with check (organization_id = current_org_id());

notify pgrst, 'reload schema';
