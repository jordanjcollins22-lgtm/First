-- Replaces the single profiles.role column with a profile_roles join table
-- so an account can hold more than one role at once (e.g. "admin" +
-- "overhead"). Also adds "overhead" as a real role, replacing the
-- hardcoded-email check the Overhead page used before this.

create table if not exists profile_roles (
  profile_id uuid not null references profiles(id) on delete cascade,
  role_name text not null references roles(name) on update cascade,
  created_at timestamptz not null default now(),
  primary key (profile_id, role_name)
);

-- Backfill everyone's existing single role before the column goes away.
insert into profile_roles (profile_id, role_name)
select id, role from profiles
on conflict do nothing;

insert into roles (name, is_system) values ('overhead', false)
on conflict (name) do nothing;

-- Grandfather the account that already had the hardcoded Overhead access in.
insert into profile_roles (profile_id, role_name)
select id, 'overhead' from profiles where email = 'jordanjcollins22@gmail.com'
on conflict do nothing;

-- is_admin() (from 0019_roles_and_assignment.sql) now checks profile_roles
-- instead of the single profiles.role column. Still security definer so it
-- can be used inside profile_roles' own RLS policy below without recursing.
create or replace function is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from profile_roles where profile_id = auth.uid() and role_name = 'admin'
  );
$$;

create or replace function has_role(check_role text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from profile_roles where profile_id = auth.uid() and role_name = check_role
  );
$$;

alter table profile_roles enable row level security;

drop policy if exists "read_all_profile_roles" on profile_roles;
create policy "read_all_profile_roles" on profile_roles for select to authenticated using (true);

drop policy if exists "admin_manage_profile_roles" on profile_roles;
create policy "admin_manage_profile_roles" on profile_roles for all to authenticated
  using (is_admin()) with check (is_admin());

-- Overhead access is now role-based instead of a hardcoded email.
drop policy if exists "jordan_manage_overhead" on overhead_expenses;
create policy "overhead_role_manage_overhead" on overhead_expenses for all to authenticated
  using (has_role('overhead')) with check (has_role('overhead'));

drop function if exists is_jordan();

-- New accounts get "crew" as their starting role (used to come from the
-- profiles.role column default).
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  insert into public.profile_roles (profile_id, role_name)
  values (new.id, 'crew')
  on conflict do nothing;
  return new;
end;
$$;

-- profiles.role is fully superseded by profile_roles now that every
-- account's role has been carried over above.
alter table profiles drop constraint if exists profiles_role_fkey;
alter table profiles drop column if exists role;
