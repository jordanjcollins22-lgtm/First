-- ============================================================
-- Communications agent.
--
-- Every inbound message GoHighLevel receives (SMS, email, Facebook,
-- Instagram, WhatsApp, Google Business, live chat) is posted to
-- /api/ghl/inbound. The app logs it here, works out who sent it, and
-- hands it to the Claude agent, which replies, escalates, or drafts a
-- reply for a manager to approve.
--
-- comm_messages  : every inbound + outbound message on every channel.
-- agent_runs     : one row per time the agent handled a message.
-- agent_drafts   : replies to customers waiting for a manager's OK.
-- employee_links : no-login links texted to employees (token is hashed).
-- ============================================================

create table if not exists agent_runs (
  id uuid primary key default gen_random_uuid(),
  -- 'team' | 'manager' | 'customer' | 'unknown'
  sender_kind text not null,
  team_member_id uuid references team_members(id) on delete set null,
  ghl_contact_id text,
  channel text not null,
  status text not null default 'running' check (status in ('running', 'done', 'error')),
  -- One line on what the agent did, for the inbox.
  summary text,
  -- Every tool call the agent made: [{ tool, input, result }].
  actions jsonb not null default '[]'::jsonb,
  error text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists agent_runs_created_idx on agent_runs (created_at desc);

create table if not exists comm_messages (
  id uuid primary key default gen_random_uuid(),
  channel text not null
    check (channel in ('sms', 'email', 'facebook', 'instagram', 'whatsapp', 'gmb', 'live_chat', 'other')),
  direction text not null check (direction in ('inbound', 'outbound')),
  sender_kind text,
  team_member_id uuid references team_members(id) on delete set null,
  ghl_contact_id text,
  ghl_conversation_id text,
  ghl_message_id text,
  contact_name text,
  -- Phone number or email address on the other end.
  contact_address text,
  subject text,
  body text not null,
  -- Which agent run sent this (outbound) or handled it (inbound).
  agent_run_id uuid references agent_runs(id) on delete set null,
  created_at timestamptz not null default now()
);

-- GHL retries webhooks; this keeps a retried message from being handled twice.
create unique index if not exists comm_messages_ghl_message_idx
  on comm_messages (ghl_message_id) where ghl_message_id is not null;
create index if not exists comm_messages_contact_idx on comm_messages (ghl_contact_id, created_at desc);
create index if not exists comm_messages_member_idx on comm_messages (team_member_id, created_at desc);
create index if not exists comm_messages_created_idx on comm_messages (created_at desc);

create table if not exists agent_drafts (
  id uuid primary key default gen_random_uuid(),
  agent_run_id uuid references agent_runs(id) on delete set null,
  ghl_contact_id text not null,
  channel text not null,
  contact_name text,
  contact_address text,
  -- What the customer said, so the approver has context.
  in_reply_to text,
  subject text,
  body text not null,
  -- Why the agent wants a human to look (always set for customer replies).
  note text,
  status text not null default 'pending' check (status in ('pending', 'sent', 'discarded', 'failed')),
  error text,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists agent_drafts_status_idx on agent_drafts (status, created_at desc);

create table if not exists employee_links (
  id uuid primary key default gen_random_uuid(),
  -- sha256 of the token in the URL. The raw token is never stored.
  token_hash text not null unique,
  team_member_id uuid not null references team_members(id) on delete cascade,
  kind text not null check (kind in ('job')),
  job_id uuid references jobs(id) on delete cascade,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  first_opened_at timestamptz,
  last_opened_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists employee_links_member_idx on employee_links (team_member_id, created_at desc);

drop trigger if exists set_updated_at on agent_drafts;
create trigger set_updated_at before update on agent_drafts
  for each row execute function set_updated_at();

alter table agent_runs enable row level security;
alter table comm_messages enable row level security;
alter table agent_drafts enable row level security;
alter table employee_links enable row level security;

-- Signed-in office users see everything (same MVP policy as the rest of the
-- schema). The webhook and the employee link pages use the service-role key.
do $$
declare
  t text;
begin
  foreach t in array array['agent_runs', 'comm_messages', 'agent_drafts', 'employee_links']
  loop
    execute format(
      'drop policy if exists "authenticated_full_access" on %I; create policy "authenticated_full_access" on %I for all to authenticated using (true) with check (true);',
      t, t
    );
  end loop;
end $$;
