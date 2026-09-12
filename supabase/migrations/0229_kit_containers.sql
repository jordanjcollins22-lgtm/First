-- What a kit is actually carried in.
--
-- A kit was a number ticked on a tool and nothing else. But a kit is not an
-- abstract set: it is a physical thing somebody wheels to a van, and knowing
-- which thing matters twice. At the end of a day, "is it all back" is really
-- "is it all back in the right bin". And when a wheel comes off the dolly, the
-- bin itself is a thing that has to be re-ordered, which nothing here could
-- record because the bin did not exist as far as the app was concerned.
--
-- One row per container, and it names the kits it holds rather than the other
-- way round -- because one dolly rig carries kits 1, 2 and 3, and a column on
-- a kit could not have said that. Kits have no table of their own: a kit
-- exists because a tool claims to be in it, so the numbers here are the same
-- integers `tools.kits` uses.
create table if not exists kit_containers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,

  name text not null,
  -- Which kits live in it. Several, because one rig often carries more than
  -- one kit, and a kit can be split across two containers.
  kits integer[] not null default '{}',

  -- 'bought' is one thing off a shelf, like a DeWalt crate. 'built' is a rig
  -- somebody assembled, like a trash can strapped to a dolly, and the parts
  -- are what gets re-ordered when one of them breaks.
  kind text not null default 'bought' check (kind in ('bought', 'built')),

  -- How many we have of it, and what one costs. A built rig's cost comes from
  -- its parts instead, so this is left null on those.
  quantity integer check (quantity is null or quantity >= 0),
  cost numeric check (cost is null or cost >= 0),
  purchase_url text,

  -- Broken and not yet replaced. A count rather than a flag: two of four
  -- crates cracked is a different order from one.
  broken integer not null default 0 check (broken >= 0),
  on_order boolean not null default false,
  reorder_threshold integer check (reorder_threshold is null or reorder_threshold >= 0),

  image_path text,
  notes text,

  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table kit_containers is
  'The physical thing a kit travels in -- a crate off a shelf, or a rig somebody built. Names the kits it holds, because one dolly setup often carries several.';

create index if not exists kit_containers_org_idx
  on kit_containers (organization_id, archived_at, name);

alter table kit_containers enable row level security;

drop policy if exists kit_containers_own_org on kit_containers;
create policy kit_containers_own_org on kit_containers
  for all using (organization_id = current_org_id())
  with check (organization_id = current_org_id());

-- The pieces a built rig is made of.
--
-- The trash can, the dolly, the bungees. Each is a thing that can break on its
-- own and be replaced on its own, which is the entire reason this table
-- exists: without it, a snapped bungee means re-ordering "the setup".
create table if not exists kit_container_parts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  container_id uuid not null references kit_containers(id) on delete cascade,

  name text not null,
  -- How many go into one of these setups. Two bungees, one can, one dolly.
  quantity integer not null default 1 check (quantity > 0),
  cost numeric check (cost is null or cost >= 0),
  purchase_url text,

  broken integer not null default 0 check (broken >= 0),
  on_order boolean not null default false,

  notes text,
  -- The order they are listed and printed in, so a checklist reads the way
  -- somebody built the thing.
  position integer not null default 0,
  created_at timestamptz not null default now()
);

comment on table kit_container_parts is
  'One piece of a built container -- the can, the dolly, the straps. Separate rows because they break and get replaced separately.';

create index if not exists kit_container_parts_container_idx
  on kit_container_parts (container_id, position, name);

alter table kit_container_parts enable row level security;

drop policy if exists kit_container_parts_own_org on kit_container_parts;
create policy kit_container_parts_own_org on kit_container_parts
  for all using (organization_id = current_org_id())
  with check (organization_id = current_org_id());

notify pgrst, 'reload schema';
