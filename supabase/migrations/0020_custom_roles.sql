-- Replaces the fixed admin/crew role list with a real "roles" table admins
-- can manage from the Team page — add or remove roles without needing a new
-- migration each time. "admin" and "crew" are marked as system roles and
-- can't be deleted (the whole app assumes an "admin" role exists, and new
-- accounts default to "crew").

create table if not exists roles (
  name text primary key,
  is_system boolean not null default false,
  created_at timestamptz not null default now()
);

insert into roles (name, is_system) values ('admin', true), ('crew', true)
on conflict (name) do nothing;

alter table roles enable row level security;

drop policy if exists "read_all_roles" on roles;
create policy "read_all_roles" on roles for select to authenticated using (true);

drop policy if exists "admin_insert_roles" on roles;
create policy "admin_insert_roles" on roles for insert to authenticated with check (is_admin());

drop policy if exists "admin_delete_roles" on roles;
create policy "admin_delete_roles" on roles for delete to authenticated using (is_admin() and not is_system);

-- profiles.role now points at a real row in "roles" instead of a hardcoded
-- list baked into a check constraint.
alter table profiles drop constraint if exists profiles_role_check;
alter table profiles
  add constraint profiles_role_fkey foreign key (role) references roles(name) on update cascade;
