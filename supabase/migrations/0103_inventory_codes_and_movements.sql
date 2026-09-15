-- A code on every item, and a record of every time one moves.
--
-- The point is not the sticker. It is that "how much toner do we get through"
-- and "who had the saw last" stop being arguments and become queries. Both
-- need the same thing underneath: a row every time something leaves and a row
-- every time it comes back, with a name and a time on it.

-- ============================================================
-- The codes themselves
-- ============================================================
-- A code points at one of three things. A tool. A material. Or a place, for
-- the cases where sticking a label on the thing is silly — you do not put a
-- QR code on each paving slab, you put one on the pallet and say how many are
-- on it.
create table if not exists inventory_codes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,

  -- Short, and what goes in the URL. Not the row id: this is printed on a
  -- label somebody types when the camera will not focus in the rain.
  code text not null,

  tool_id uuid references tools(id) on delete cascade,
  material_id uuid references materials(id) on delete cascade,

  -- Set instead of the two above when the label goes on a place rather than
  -- a thing: "the mulch bay", "shelf 3".
  storage_location text,
  label text,

  -- For a place-code, how many are supposed to be there. What a stock count
  -- is checked against.
  expected_quantity numeric check (expected_quantity is null or expected_quantity >= 0),

  active boolean not null default true,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),

  unique (organization_id, code),

  -- Exactly one subject. A code that points at two things tells you nothing
  -- about either.
  constraint inventory_codes_one_subject check (
    (tool_id is not null)::int + (material_id is not null)::int +
    (storage_location is not null)::int = 1
  )
);

create index if not exists inventory_codes_org_idx on inventory_codes(organization_id, active);
create index if not exists inventory_codes_tool_idx on inventory_codes(tool_id) where tool_id is not null;
create index if not exists inventory_codes_material_idx on inventory_codes(material_id) where material_id is not null;

alter table inventory_codes enable row level security;
drop policy if exists "org_scoped_inventory_codes" on inventory_codes;
create policy "org_scoped_inventory_codes" on inventory_codes for all to authenticated
  using (organization_id = current_org_id())
  with check (organization_id = current_org_id());

-- ============================================================
-- Every time something moves
-- ============================================================
-- Append-only in spirit: a movement is something that happened, and things
-- that happened do not get edited. A mistake is corrected by moving it back,
-- which is also what happened.
create table if not exists inventory_movements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,

  tool_id uuid references tools(id) on delete cascade,
  material_id uuid references materials(id) on delete cascade,
  code_id uuid references inventory_codes(id) on delete set null,

  -- out = left the shelf. in = came back. count = somebody counted what is
  -- actually there, which is how the ledger gets told it has drifted.
  direction text not null check (direction in ('out', 'in', 'count')),
  quantity numeric not null check (quantity >= 0),

  -- Who, and what for. Both matter: "who had the saw last" is the first, and
  -- "what did that job actually use" is the second.
  profile_id uuid references profiles(id),
  job_id uuid references jobs(id) on delete set null,

  note text,
  happened_at timestamptz not null default now(),

  constraint inventory_movements_one_subject check (
    (tool_id is not null)::int + (material_id is not null)::int = 1
  )
);

-- The two questions this table exists to answer, indexed.
create index if not exists inventory_movements_tool_idx
  on inventory_movements(tool_id, happened_at desc) where tool_id is not null;
create index if not exists inventory_movements_material_idx
  on inventory_movements(material_id, happened_at desc) where material_id is not null;
create index if not exists inventory_movements_org_idx
  on inventory_movements(organization_id, happened_at desc);

alter table inventory_movements enable row level security;
drop policy if exists "org_scoped_inventory_movements" on inventory_movements;
create policy "org_scoped_inventory_movements" on inventory_movements for all to authenticated
  using (organization_id = current_org_id())
  with check (organization_id = current_org_id());

notify pgrst, 'reload schema';
