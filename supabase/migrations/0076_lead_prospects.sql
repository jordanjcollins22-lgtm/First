-- Prospects: properties the business has NOT worked with yet, imported from
-- public parcel records or a bought list, so the lead engine has something to
-- score beyond its own client book.
--
-- Kept separate from customers on purpose. A prospect is somebody who hasn't
-- asked for anything; mixing them into the client table would put strangers in
-- every contact picker and every count of "our clients".

create table if not exists lead_prospects (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),

  -- Where the row came from, so a bad import can be found and removed whole.
  source text not null,
  source_batch text,

  owner_name text,
  address text not null,
  -- Normalised address, written by the app. Dedupes imports against each
  -- other and against existing clients.
  address_key text not null,
  city text,
  state text,
  zip text,
  lat double precision,
  lng double precision,

  acreage numeric,
  sqft numeric,
  year_built integer,
  assessed_value numeric,

  phone text,
  email text,

  status text not null default 'new'
    check (status in ('new', 'queued', 'contacted', 'converted', 'rejected')),
  -- Set when somebody asks not to be contacted again. Separate from status so
  -- it survives every other change and can never be undone by a status edit.
  do_not_contact boolean not null default false,
  do_not_contact_reason text,

  estimated_ticket numeric,
  score integer,
  notes text,

  -- Filled in when a prospect becomes a real client, so the list stops
  -- suggesting somebody already being worked.
  converted_customer_id uuid references customers(id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- The same property imported twice updates rather than duplicating.
  unique (organization_id, address_key)
);

create index if not exists lead_prospects_org_status_idx
  on lead_prospects(organization_id, status);
create index if not exists lead_prospects_org_score_idx
  on lead_prospects(organization_id, score desc);

drop trigger if exists set_updated_at on lead_prospects;
create trigger set_updated_at before update on lead_prospects
  for each row execute function set_updated_at();

alter table lead_prospects enable row level security;

-- Prospect lists carry names and addresses of people who never asked to be in
-- the system, so this is admin-only rather than org-wide.
drop policy if exists "admin_manage_lead_prospects" on lead_prospects;
create policy "admin_manage_lead_prospects" on lead_prospects for all to authenticated
  using (organization_id = current_org_id() and is_admin())
  with check (organization_id = current_org_id() and is_admin());

notify pgrst, 'reload schema';
