-- Tools & materials catalog, with costs, for the design canvas.
-- service_tools / service_materials drive automatic (not manual) selection:
-- the canvas UI reads these mappings instead of hardcoding a kit per service.
-- Service type ids here match the ids in src/components/canvas/service-catalog.ts
-- (those service *definitions* — fields, auto-scope text — stay code-defined;
-- only tools/materials/costs move into the database).

-- ============================================================
-- tools
-- ============================================================
create table if not exists tools (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  icon text not null default '🧰',
  cost numeric(10, 2),
  is_rental boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================
-- materials
-- ============================================================
create table if not exists materials (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  unit text not null,
  coverage_per_unit_sqft numeric(10, 2),
  waste_factor_pct numeric(5, 2) not null default 10,
  cost_per_unit numeric(10, 2),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================
-- service_tools — which tools auto-apply to which service type
-- ============================================================
create table if not exists service_tools (
  service_type_id text not null,
  tool_id uuid not null references tools(id) on delete cascade,
  primary key (service_type_id, tool_id)
);

create index if not exists service_tools_service_type_idx on service_tools(service_type_id);

-- ============================================================
-- service_materials — which materials auto-apply to which service type,
-- optionally gated on one of that service's field values
-- (match_field/match_value null = always applies to the service).
-- ============================================================
create table if not exists service_materials (
  id uuid primary key default gen_random_uuid(),
  service_type_id text not null,
  material_id uuid not null references materials(id) on delete cascade,
  match_field text,
  match_value text,
  created_at timestamptz not null default now()
);

create index if not exists service_materials_service_type_idx on service_materials(service_type_id);

-- ============================================================
-- updated_at triggers (reuses the set_updated_at() function from 0001_init.sql)
-- ============================================================
do $$
declare
  t text;
begin
  foreach t in array array['tools', 'materials']
  loop
    execute format(
      'drop trigger if exists set_updated_at on %I; create trigger set_updated_at before update on %I for each row execute function set_updated_at();',
      t, t
    );
  end loop;
end $$;

-- ============================================================
-- Row Level Security — same permissive MVP policy as the rest of the app.
-- ============================================================
alter table tools enable row level security;
alter table materials enable row level security;
alter table service_tools enable row level security;
alter table service_materials enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['tools', 'materials', 'service_tools', 'service_materials']
  loop
    execute format(
      'drop policy if exists "authenticated_full_access" on %I; create policy "authenticated_full_access" on %I for all to authenticated using (true) with check (true);',
      t, t
    );
  end loop;
end $$;

-- ============================================================
-- Seed data — a reasonable starting catalog (icons, default kits, and rough
-- coverage rates). Costs are left null; fill them in from /admin/tools and
-- /admin/materials once you have real numbers.
-- ============================================================
insert into tools (name, icon, is_rental) values
  ('Shovel', '⛏️', false),
  ('Spade', '⛏️', false),
  ('Bed Edger', '🔪', false),
  ('Rake', '🧹', false),
  ('Wheelbarrow', '🛒', false),
  ('Bed Blade', '🔪', false),
  ('Tarp', '🧺', false),
  ('Gloves', '🧤', false),
  ('Mattock', '⛏️', false),
  ('Loppers', '✂️', false),
  ('Pruning Saw', '🪚', false),
  ('Root Saw', '🪚', false),
  ('Trowel', '🥄', false),
  ('Hose', '💧', false),
  ('Watering Can', '🚿', false),
  ('Hand Pruners', '✂️', false),
  ('Hedge Trimmer', '✂️', false),
  ('Pole Saw', '🪚', false),
  ('Leaf Blower', '🌬️', false),
  ('Trash Bags', '🗑️', false),
  ('Spreader', '🌱', false),
  ('Aerator', '🛠️', true),
  ('Topsoil Rake', '🧹', false),
  ('Landscape Rake', '🧹', false),
  ('Level', '📏', false),
  ('Stakes & String', '🧵', false),
  ('Soft Wash System', '🧽', false),
  ('Extension Wand', '🧽', false),
  ('Chemical Sprayer', '🧴', false),
  ('Surface Cleaner', '🧽', false),
  ('Stump Grinder', '🛠️', true),
  ('Sod Cutter', '🛠️', true)
on conflict (name) do nothing;

insert into materials (name, unit, coverage_per_unit_sqft, waste_factor_pct) values
  ('Mulch', 'cubic yards', 100, 10),
  ('Rock', 'cubic yards', 80, 10),
  ('Topsoil', 'cubic yards', 110, 10),
  ('Grass seed', 'lb', 200, 5)
on conflict (name) do nothing;

insert into service_tools (service_type_id, tool_id)
select v.service_type_id, t.id
from (values
  ('landscape-bed', 'Shovel'), ('landscape-bed', 'Spade'), ('landscape-bed', 'Bed Edger'),
  ('landscape-bed', 'Rake'), ('landscape-bed', 'Wheelbarrow'), ('landscape-bed', 'Bed Blade'),
  ('landscape-bed', 'Tarp'), ('landscape-bed', 'Gloves'),

  ('plant-bush-removal', 'Shovel'), ('plant-bush-removal', 'Mattock'), ('plant-bush-removal', 'Loppers'),
  ('plant-bush-removal', 'Pruning Saw'), ('plant-bush-removal', 'Root Saw'),
  ('plant-bush-removal', 'Wheelbarrow'), ('plant-bush-removal', 'Tarp'),

  ('plant-installation', 'Shovel'), ('plant-installation', 'Trowel'), ('plant-installation', 'Wheelbarrow'),
  ('plant-installation', 'Hose'), ('plant-installation', 'Watering Can'), ('plant-installation', 'Gloves'),

  ('trimming', 'Hand Pruners'), ('trimming', 'Loppers'), ('trimming', 'Hedge Trimmer'),
  ('trimming', 'Pole Saw'), ('trimming', 'Tarp'), ('trimming', 'Gloves'),

  ('landscape-cleanup', 'Rake'), ('landscape-cleanup', 'Leaf Blower'), ('landscape-cleanup', 'Loppers'),
  ('landscape-cleanup', 'Wheelbarrow'), ('landscape-cleanup', 'Tarp'), ('landscape-cleanup', 'Trash Bags'),

  ('lawn-restoration', 'Rake'), ('lawn-restoration', 'Spreader'), ('lawn-restoration', 'Aerator'),
  ('lawn-restoration', 'Topsoil Rake'), ('lawn-restoration', 'Wheelbarrow'),

  ('grading', 'Shovel'), ('grading', 'Rake'), ('grading', 'Landscape Rake'),
  ('grading', 'Wheelbarrow'), ('grading', 'Level'), ('grading', 'Stakes & String'),

  ('leaf-seasonal-cleanup', 'Leaf Blower'), ('leaf-seasonal-cleanup', 'Rake'), ('leaf-seasonal-cleanup', 'Tarp'),
  ('leaf-seasonal-cleanup', 'Loppers'), ('leaf-seasonal-cleanup', 'Trash Bags'),

  ('soft-washing', 'Soft Wash System'), ('soft-washing', 'Extension Wand'), ('soft-washing', 'Chemical Sprayer'),
  ('soft-washing', 'Tarp'), ('soft-washing', 'Surface Cleaner'), ('soft-washing', 'Hose')
) as v(service_type_id, tool_name)
join tools t on t.name = v.tool_name
on conflict do nothing;

insert into service_materials (service_type_id, material_id, match_field, match_value)
select v.service_type_id, m.id, v.match_field, v.match_value
from (values
  ('landscape-bed', 'Mulch', 'material', 'Mulch'),
  ('landscape-bed', 'Rock', 'material', 'Rock'),
  ('lawn-restoration', 'Topsoil', 'soilCondition', 'Needs Topsoil'),
  ('lawn-restoration', 'Grass seed', null::text, null::text),
  ('grading', 'Topsoil', 'purpose', 'Landscape-to-Lawn')
) as v(service_type_id, material_name, match_field, match_value)
join materials m on m.name = v.material_name
on conflict do nothing;
