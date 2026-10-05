-- Every computer running the post finder: which one, whose app sign-in it
-- runs under, the extension version, when it last checked in and what it
-- last looked at. With more than one running at once, the app splits the
-- searches and listed groups between them, and only one reads the reviews.
create table if not exists finder_computers (
  id text primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  profile_id uuid references profiles(id) on delete set null,
  version text,
  label text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_look jsonb,
  last_look_at timestamptz
);

comment on table finder_computers is
  'Each computer running the post finder extension: whose sign-in, version, last check-in and last look. Used to share the looking out between computers.';

create index if not exists finder_computers_org_idx on finder_computers (organization_id, last_seen_at desc);

alter table finder_computers enable row level security;

create policy finder_computers_own_org on finder_computers
  for select to authenticated
  using (organization_id = current_org_id());

notify pgrst, 'reload schema';
