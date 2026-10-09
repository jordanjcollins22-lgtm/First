-- Facebook and Instagram, connected from the app rather than from Vercel.
--
-- The business makes one Meta app, once, and pastes its id and secret into
-- Admin > Facebook & Instagram. From then on "Connect Facebook" fetches a key
-- for every page the owner ticks, finds each page's Instagram, and switches
-- on message delivery, so a new page is one click and never an env var.
--
-- Keys live here, and only the server reads them: no policy grants a signed-
-- in user any access to these two tables. The admin page talks to them
-- through server code with the service role, and shows whether a key is
-- present, never the key.
create table if not exists meta_settings (
  organization_id uuid primary key references organizations(id) on delete cascade,
  app_id text,
  app_secret text,
  -- Facebook Login for Business asks for a saved configuration instead of a
  -- list of permissions. Optional: without it the classic permission list is asked.
  login_config_id text,
  -- What Meta must send back when it checks the message address.
  verify_token text not null default ('jsl-' || replace(gen_random_uuid()::text, '-', '')),
  -- The owner's long-lived key, kept so "Refresh pages" works without logging in again.
  user_token text,
  connected_by uuid references profiles(id) on delete set null,
  connected_at timestamptz,
  webhooks_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now()
);

alter table meta_settings enable row level security;

create table if not exists meta_pages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  page_id text not null,
  name text not null,
  access_token text not null,
  instagram_id text,
  instagram_username text,
  -- What the page is for: 'posting' (the week's posts go here), 'inbox'
  -- (its DMs come into the app), 'collector' (affiliates send posts to it).
  roles text[] not null default '{inbox}',
  subscribed_at timestamptz,
  last_error text,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, page_id)
);

create index if not exists meta_pages_page_idx on meta_pages (page_id);
create index if not exists meta_pages_instagram_idx on meta_pages (instagram_id) where instagram_id is not null;

alter table meta_pages enable row level security;

-- Every message in and out of a connected page or its Instagram.
create table if not exists meta_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  page_row_id uuid not null references meta_pages(id) on delete cascade,
  platform text not null check (platform in ('facebook', 'instagram')),
  -- The other person in the conversation (their id on that platform).
  contact_id text not null,
  contact_name text,
  direction text not null check (direction in ('in', 'out')),
  body text,
  attachments jsonb not null default '[]',
  -- Meta's own id for the message, so a delivery sent twice is kept once.
  mid text unique,
  sent_by uuid references profiles(id) on delete set null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists meta_messages_thread_idx on meta_messages (organization_id, page_row_id, platform, contact_id, created_at desc);
create index if not exists meta_messages_unread_idx on meta_messages (organization_id, created_at desc) where direction = 'in' and read_at is null;

alter table meta_messages enable row level security;

drop policy if exists meta_messages_own_org on meta_messages;
create policy meta_messages_own_org on meta_messages
  for all using (organization_id = current_org_id())
  with check (organization_id = current_org_id());
