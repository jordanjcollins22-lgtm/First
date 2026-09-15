-- Automated reminders to clients, and the record that keeps them lawful.
--
-- Three things, and the order matters: what somebody has agreed to, what we
-- actually sent them, and what the business asked us to send. Without the
-- first two, the third is a machine that texts people and cannot prove it was
-- allowed to or say whether it already did.

-- What a client has said about being contacted, per channel.
--
-- "unknown" is the honest default and it is where every existing client
-- starts: nobody ever put a tick box in front of them. It is enough for
-- messages about work they have booked and not enough for anything else --
-- that rule lives in lib/client-consent.ts, and this table only remembers.
--
-- Every change keeps its evidence. "They replied STOP on 3 March" and "they
-- ticked the box on the booking form" are the two sentences that matter when
-- somebody asks why we did or did not write to a person.
create table if not exists client_consent (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  customer_id uuid not null references customers(id) on delete cascade,
  channel text not null check (channel in ('sms', 'email')),
  state text not null default 'unknown' check (state in ('unknown', 'granted', 'revoked')),
  -- Where this came from: 'reply' (they texted STOP or START), 'form' (they
  -- ticked something), 'import' (it came over with the contact), 'office'
  -- (somebody here set it).
  source text not null default 'unknown',
  -- The words, so the reason survives the person who knew it.
  evidence text,
  changed_at timestamptz not null default now(),
  changed_by uuid references profiles(id) on delete set null,
  unique (customer_id, channel)
);

create index if not exists client_consent_org_idx on client_consent (organization_id, channel, state);

alter table client_consent enable row level security;

drop policy if exists client_consent_own_org on client_consent;
create policy client_consent_own_org on client_consent
  for all using (organization_id = current_org_id())
  with check (organization_id = current_org_id());

-- Every message we sent a client, and every one we decided not to.
--
-- The dedupe key is the point of this table. A cron that runs twice, runs
-- late, or runs twice at once is normal, and without a unique key on what a
-- send is, all three of those text somebody the same thing again. The unique
-- constraint is the guarantee; the code merely tries not to need it.
--
-- Skips are written down too. Every reason a message did not go used to be
-- silence, and silence looks exactly like a message that went.
create table if not exists client_message_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  customer_id uuid references customers(id) on delete set null,
  channel text not null check (channel in ('sms', 'email')),
  kind text not null,
  -- The job, proposal or invoice this was about.
  reference_id uuid,
  dedupe_key text not null,
  status text not null check (status in ('sent', 'skipped', 'failed')),
  -- Why, when it did not go. One of the reasons in lib/client-consent.ts.
  skip_reason text,
  detail text,
  -- What the provider called it, for chasing a delivery with Twilio or Resend.
  provider_id text,
  body text,
  created_at timestamptz not null default now(),
  unique (organization_id, dedupe_key)
);

create index if not exists client_message_log_customer_idx
  on client_message_log (customer_id, created_at desc);

alter table client_message_log enable row level security;

drop policy if exists client_message_log_own_org on client_message_log;
create policy client_message_log_own_org on client_message_log
  for all using (organization_id = current_org_id())
  with check (organization_id = current_org_id());

-- Which reminders this business sends, and when.
--
-- Rows only where somebody has changed something. An empty table means the
-- defaults in lib/client-reminders.ts, so a new business is sensible before
-- anybody visits the settings screen, and a reminder added to the app later
-- arrives switched on at its default rather than silently off.
create table if not exists reminder_rules (
  organization_id uuid not null references organizations(id) on delete cascade,
  kind text not null,
  enabled boolean not null default true,
  channels text[] not null default array['sms']::text[],
  offsets_hours integer[] not null default array[-18]::integer[],
  updated_at timestamptz not null default now(),
  updated_by uuid references profiles(id) on delete set null,
  primary key (organization_id, kind)
);

alter table reminder_rules enable row level security;

drop policy if exists reminder_rules_own_org on reminder_rules;
create policy reminder_rules_own_org on reminder_rules
  for all using (organization_id = current_org_id())
  with check (organization_id = current_org_id());

-- The master switch, and the hours a client may be written to.
--
-- Off until somebody turns it on. Everything else here can be built, deployed
-- and looked at without a single client hearing anything, which is the only
-- safe way to ship a thing that texts people.
alter table organizations add column if not exists client_reminders_enabled boolean not null default false;
alter table organizations add column if not exists reminder_time_zone text not null default 'America/New_York';
alter table organizations add column if not exists reminder_quiet_start integer not null default 8
  check (reminder_quiet_start between 0 and 23);
alter table organizations add column if not exists reminder_quiet_end integer not null default 21
  check (reminder_quiet_end between 1 and 24);

comment on column organizations.client_reminders_enabled is
  'The master switch for automated client reminders. Off by default: a thing that texts people ships switched off.';
comment on column organizations.reminder_time_zone is
  'The clock quiet hours are read against. The client''s local time, not the server''s.';

-- Somebody has to be able to unsubscribe from an email without signing in,
-- which means a link that identifies them and nothing else.
alter table customers add column if not exists unsubscribe_token text unique;

update customers set unsubscribe_token = encode(gen_random_bytes(16), 'hex')
  where unsubscribe_token is null;

create or replace function public.customer_unsubscribe_token()
returns trigger
language plpgsql
as $$
begin
  if new.unsubscribe_token is null then
    new.unsubscribe_token := encode(gen_random_bytes(16), 'hex');
  end if;
  return new;
end $$;

drop trigger if exists customers_get_an_unsubscribe_token on customers;
create trigger customers_get_an_unsubscribe_token
  before insert on customers
  for each row execute function public.customer_unsubscribe_token();

notify pgrst, 'reload schema';
