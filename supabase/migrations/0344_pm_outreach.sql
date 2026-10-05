-- Cold email to local property management companies: the companies found,
-- the emails written for each, and the settings. Nothing is sent until the
-- owner switches sending on, a sending mailbox is set up and the business
-- has a street address (every cold email has to carry one).

create table if not exists pm_companies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  website text,
  phone text,
  address text,
  lat double precision,
  lng double precision,
  -- Google's id for the place, so the same company found twice is one row.
  place_id text,
  source text not null default 'manual' check (source in ('google_places', 'manual')),
  contact_name text,
  email text,
  email_source text check (email_source in ('website', 'manual')),
  -- new: found, emails not looked for yet. no_email: looked, none found.
  -- ready: has an email, sequence not written. drafted: written, waiting for
  -- a yes. approved: going out on schedule. replied / interested /
  -- not_interested / unsubscribed / bounced / do_not_contact: stopped.
  status text not null default 'new' check (status in ('new', 'no_email', 'ready', 'drafted', 'approved', 'replied', 'interested', 'not_interested', 'unsubscribed', 'bounced', 'do_not_contact')),
  note text,
  unsubscribe_token text not null default encode(gen_random_bytes(16), 'hex'),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists pm_companies_place_idx on pm_companies (organization_id, place_id) where place_id is not null;
create unique index if not exists pm_companies_place_unique on pm_companies (organization_id, place_id);
create index if not exists pm_companies_status_idx on pm_companies (organization_id, status);
create unique index if not exists pm_companies_unsubscribe_idx on pm_companies (unsubscribe_token);

create table if not exists pm_emails (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  company_id uuid not null references pm_companies(id) on delete cascade,
  step integer not null check (step between 1 and 5),
  subject text not null,
  body text not null,
  status text not null default 'draft' check (status in ('draft', 'scheduled', 'sent', 'skipped', 'failed')),
  send_after timestamptz,
  sent_at timestamptz,
  message_id text,
  error text,
  created_at timestamptz not null default now(),
  unique (company_id, step)
);

create index if not exists pm_emails_due_idx on pm_emails (organization_id, status, send_after);

create table if not exists pm_outreach_settings (
  organization_id uuid primary key references organizations(id) on delete cascade,
  -- The owner's switch. Off until they say so.
  sending_on boolean not null default false,
  -- Every new sequence waits for a person to read it until this is on.
  auto_approve boolean not null default false,
  daily_cap integer not null default 20 check (daily_cap between 1 and 200),
  from_name text,
  story text,
  offer text,
  towns text[] not null default array['Bel Air, MD', 'Abingdon, MD', 'Aberdeen, MD', 'Havre de Grace, MD', 'Edgewood, MD', 'Fallston, MD', 'Forest Hill, MD', 'Joppa, MD', 'White Marsh, MD', 'Perry Hall, MD'],
  last_search_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table pm_companies enable row level security;
alter table pm_emails enable row level security;
alter table pm_outreach_settings enable row level security;

create policy pm_companies_own_org on pm_companies for all to authenticated
  using (organization_id = current_org_id()) with check (organization_id = current_org_id());
create policy pm_emails_own_org on pm_emails for all to authenticated
  using (organization_id = current_org_id()) with check (organization_id = current_org_id());
create policy pm_outreach_settings_own_org on pm_outreach_settings for all to authenticated
  using (organization_id = current_org_id()) with check (organization_id = current_org_id());

notify pgrst, 'reload schema';

-- The reply that stopped a sequence, so it is on the company's card.
alter table pm_companies add column if not exists replied_at timestamptz;
alter table pm_companies add column if not exists last_reply text;
