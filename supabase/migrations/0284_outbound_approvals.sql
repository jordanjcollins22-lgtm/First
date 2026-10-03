-- Nothing automatic goes to a client until somebody here has read it.
--
-- Every email the machine writes on its own, the evaluation sequence and the
-- reminders, is parked here first when the business asks for that. The owner
-- is told, reads it, and taps approve or decline. What was waiting and what
-- happened to it stays, because "did that go" has to have an answer.
alter table organizations add column if not exists require_email_approval boolean not null default false;
comment on column organizations.require_email_approval is
  'When true, every automatic email to a client waits for an owner or admin to approve it.';

create table if not exists outbound_approvals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  source text not null check (source in ('evaluation_sequence', 'client_reminder')),
  -- What it is, for the person reading the list: evaluation_booked, proposal_follow_up...
  kind text not null,
  -- The same key the send is logged under, so the same email cannot be parked twice.
  dedupe_key text not null,
  customer_id uuid references customers(id) on delete set null,
  job_id uuid references jobs(id) on delete set null,
  to_email text not null,
  to_name text,
  subject text not null,
  body text not null,
  -- What finishing the send needs that the row above does not say.
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'sent', 'declined', 'failed', 'expired')),
  -- After this it is too late to send: a "see you tomorrow" after the visit is worse than nothing.
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references profiles(id) on delete set null,
  sent_at timestamptz,
  provider_id text,
  detail text,
  unique (organization_id, dedupe_key)
);

create index if not exists outbound_approvals_pending_idx
  on outbound_approvals (organization_id, created_at desc) where status = 'pending';

alter table outbound_approvals enable row level security;

drop policy if exists outbound_approvals_own_org on outbound_approvals;
create policy outbound_approvals_own_org on outbound_approvals
  for all using (organization_id = (select current_org_id()))
  with check (organization_id = (select current_org_id()));
