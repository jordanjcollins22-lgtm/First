-- The in-app wallet's payout requests.
--
-- An affiliate's 4% lands in their wallet once the client pays. Getting it to
-- their bank is a request, never a transfer: the owner approves it (or says
-- why not), then whoever sends the money sends it and marks it sent. Marking
-- it sent writes the commission_payouts rows, so the wallet goes down by
-- exactly what reached them. Nothing here moves money on its own.
create table if not exists public.payout_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  amount numeric(12,2) not null check (amount > 0),
  status text not null default 'requested' check (status in ('requested', 'approved', 'declined', 'sent', 'cancelled')),
  requested_at timestamptz not null default now(),
  decided_by uuid references public.profiles(id) on delete set null,
  decided_at timestamptz,
  decision_note text,
  sent_at timestamptz,
  sent_by uuid references public.profiles(id) on delete set null,
  method text,
  reference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists payout_requests_org_status_idx on public.payout_requests (organization_id, status);
create index if not exists payout_requests_profile_idx on public.payout_requests (profile_id, requested_at desc);

-- One open request per person: a second tap while one is waiting is the same ask.
create unique index if not exists payout_requests_one_open_idx
  on public.payout_requests (profile_id) where status in ('requested', 'approved');

alter table public.payout_requests enable row level security;

-- The business's own rows. Who may ask, approve and send is checked by the app's actions.
drop policy if exists payout_requests_own_org on public.payout_requests;
create policy payout_requests_own_org on public.payout_requests
  for all using (organization_id = current_org_id())
  with check (organization_id = current_org_id());

notify pgrst, 'reload schema';
