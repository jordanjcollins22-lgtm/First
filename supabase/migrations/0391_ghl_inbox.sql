-- Every message somebody sends the business through GoHighLevel.
--
-- Two roads fill this table: the GoHighLevel "Customer Replied" workflow
-- posting to /api/webhooks/ghl-message the moment a message lands, and the
-- every-minute sweep (/api/cron/ghl-inbox-sweep) that reads GoHighLevel's
-- recent conversations and saves whatever the webhook missed. One row per
-- GoHighLevel message id, so a message that arrives both ways counts once.
--
-- Nothing is dropped: a number with no client (a new lead) and a client
-- with no job are kept here with customer_id / job_id left empty.
create table if not exists public.ghl_inbound_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  ghl_message_id text not null unique,
  conversation_id text,
  contact_id text,
  phone text,
  email text,
  contact_name text,
  channel text not null default 'SMS',
  body text not null,
  received_at timestamptz not null,
  captured_at timestamptz not null default now(),
  captured_via text not null check (captured_via in ('webhook', 'sweep')),
  customer_id uuid references public.customers(id) on delete set null,
  job_id uuid references public.jobs(id) on delete set null,
  job_message_id uuid,
  alerted_at timestamptz,
  handled_at timestamptz,
  raw jsonb
);

create index if not exists ghl_inbound_messages_received_idx
  on public.ghl_inbound_messages (organization_id, received_at desc);
create index if not exists ghl_inbound_messages_open_idx
  on public.ghl_inbound_messages (organization_id, received_at desc) where handled_at is null;

alter table public.ghl_inbound_messages enable row level security;

-- Office staff can read their own business's messages; writes are the
-- server's alone (service role).
drop policy if exists ghl_inbound_messages_read on public.ghl_inbound_messages;
create policy ghl_inbound_messages_read on public.ghl_inbound_messages
  for select to authenticated
  using (organization_id in (select organization_id from public.profiles where id = auth.uid()));

-- The sweep's own scorecard: one row. Three failed runs in a row, or no
-- clean run in 10 minutes, and the admins are told once an hour.
create table if not exists public.ghl_capture_state (
  id int primary key check (id = 1),
  last_run_at timestamptz,
  last_ok_at timestamptz,
  failures_in_a_row int not null default 0,
  last_error text,
  last_stored int,
  health_alerted_at timestamptz
);
alter table public.ghl_capture_state enable row level security;
insert into public.ghl_capture_state (id) values (1) on conflict (id) do nothing;

comment on table public.ghl_inbound_messages is
  'Every inbound GoHighLevel message (SMS, email, FB, IG, GMB, chat), from the webhook or the every-minute sweep. One row per GHL message id.';
