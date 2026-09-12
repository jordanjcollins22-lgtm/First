-- Adds tool "kit" grouping + tool images, and a canvas_designs table so a
-- job's canvas (background image, zones, property line) can be saved to the
-- database instead of only the browser's IndexedDB. Policies are open to
-- anon + authenticated from the start (see 0005's fix) since this app has
-- no login flow.

alter table tools add column if not exists kit text;
alter table tools add column if not exists image_path text;

insert into storage.buckets (id, name, public)
values ('tool-images', 'tool-images', true)
on conflict (id) do nothing;

drop policy if exists "open_read_tool_images" on storage.objects;
create policy "open_read_tool_images"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'tool-images');

drop policy if exists "open_write_tool_images" on storage.objects;
create policy "open_write_tool_images"
  on storage.objects for insert
  to anon, authenticated
  with check (bucket_id = 'tool-images');

drop policy if exists "open_update_tool_images" on storage.objects;
create policy "open_update_tool_images"
  on storage.objects for update
  to anon, authenticated
  using (bucket_id = 'tool-images');

drop policy if exists "open_delete_tool_images" on storage.objects;
create policy "open_delete_tool_images"
  on storage.objects for delete
  to anon, authenticated
  using (bucket_id = 'tool-images');

-- ============================================================
-- canvas_designs — one saved canvas per job (background image, zones,
-- rough property line). Mirrors src/components/canvas/types.ts StoredDesign,
-- plus job_id and a property_line.
-- ============================================================
create table if not exists canvas_designs (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null unique references jobs(id) on delete cascade,
  address text not null default '',
  image_path text,
  image_x double precision not null default 500,
  image_y double precision not null default 312.5,
  image_scale double precision not null default 1,
  image_rotation double precision not null default 0,
  image_real_width_feet double precision,
  locked boolean not null default false,
  property_line jsonb not null default '[]',
  zones jsonb not null default '[]',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_updated_at on canvas_designs;
create trigger set_updated_at before update on canvas_designs for each row execute function set_updated_at();

alter table canvas_designs enable row level security;
drop policy if exists "authenticated_full_access" on canvas_designs;
create policy "authenticated_full_access" on canvas_designs for all to anon, authenticated using (true) with check (true);

insert into storage.buckets (id, name, public)
values ('canvas-images', 'canvas-images', true)
on conflict (id) do nothing;

drop policy if exists "open_read_canvas_images" on storage.objects;
create policy "open_read_canvas_images"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'canvas-images');

drop policy if exists "open_write_canvas_images" on storage.objects;
create policy "open_write_canvas_images"
  on storage.objects for insert
  to anon, authenticated
  with check (bucket_id = 'canvas-images');

drop policy if exists "open_update_canvas_images" on storage.objects;
create policy "open_update_canvas_images"
  on storage.objects for update
  to anon, authenticated
  using (bucket_id = 'canvas-images');

drop policy if exists "open_delete_canvas_images" on storage.objects;
create policy "open_delete_canvas_images"
  on storage.objects for delete
  to anon, authenticated
  using (bucket_id = 'canvas-images');
