-- Sending our own email, from domains we prove we own.
--
-- Reputation attaches to the domain that signs the mail. A cold campaign sent
-- from jslandscapingmd.com spends every bounce and every spam report against
-- the same name that carries the invoices and the password resets, and that
-- damage is slow to do and much slower to undo.
--
-- So the root domain sends nothing. Transactional mail goes from one
-- subdomain, marketing from another, and the root is left free to hold a
-- strict DMARC policy — its reputation stays untouchable because it has none
-- to spend. The rule is enforced in the app, not written on a help page,
-- because an advisory version is one somebody skips at nine at night.

create table if not exists email_domains (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,

  -- Always a subdomain. Never the registrable domain itself.
  hostname text not null,
  stream text not null check (stream in ('transactional', 'marketing')),

  -- Who is actually sending it, and their id for this domain, so a status
  -- check does not have to search by name.
  provider text not null default 'resend',
  provider_domain_id text,

  status text not null default 'pending' check (status in ('pending', 'verified', 'failed')),
  -- The DNS the owner still has to add, exactly as the provider gave it. Kept
  -- verbatim: a DKIM value we have "tidied" is a DKIM value that fails, and
  -- the failure arrives as silence rather than an error.
  dns_records jsonb not null default '[]'::jsonb,
  last_checked_at timestamptz,

  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),

  unique (organization_id, hostname)
);

-- One domain per stream. Two marketing domains is two reputations to keep an
-- eye on and no way to say which a campaign went from.
create unique index if not exists email_domains_one_per_stream_idx
  on email_domains(organization_id, stream);

alter table email_domains enable row level security;
drop policy if exists "org_scoped_email_domains" on email_domains;
create policy "org_scoped_email_domains" on email_domains for all to authenticated
  using (organization_id = current_org_id())
  with check (organization_id = current_org_id());

-- ---------------------------------------------------------------------------
-- The addresses themselves
-- ---------------------------------------------------------------------------
-- Added by hand, one at a time, because every one of them is a place a human
-- reply can land and somebody has to be reading it.
create table if not exists email_senders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  domain_id uuid not null references email_domains(id) on delete cascade,

  -- Stored lower-cased, so two spellings of one address cannot both exist.
  address text not null,
  display_name text,

  -- Where replies actually go. Almost always a real monitored mailbox on the
  -- root domain — the sending subdomain exists to protect reputation, not to
  -- be somewhere anybody reads.
  reply_to text,

  is_default boolean not null default false,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),

  unique (organization_id, address)
);

create index if not exists email_senders_domain_idx on email_senders(domain_id);
-- One default per domain, so "which address did that go from" has one answer.
create unique index if not exists email_senders_one_default_idx
  on email_senders(domain_id) where is_default;

alter table email_senders enable row level security;
drop policy if exists "org_scoped_email_senders" on email_senders;
create policy "org_scoped_email_senders" on email_senders for all to authenticated
  using (organization_id = current_org_id())
  with check (organization_id = current_org_id());

notify pgrst, 'reload schema';
