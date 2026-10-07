-- Adds team roles (admin/crew) and lets jobs be assigned to a team member.
-- Every signed-in account gets a profile row (role defaults to "crew" —
-- someone has to be promoted to "admin" by hand the first time, see the
-- backfill + instructions below). This migration does NOT yet restrict what
-- crew can see/do beyond the Team page itself — that's a separate, deliberate
-- follow-up once the role data actually exists.

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  role text not null default 'crew' check (role in ('admin', 'crew')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_updated_at on profiles;
create trigger set_updated_at before update on profiles for each row execute function set_updated_at();

alter table profiles enable row level security;

-- Every signed-in user can see the team roster (needed for assignment
-- dropdowns and "assigned to" labels) — only admins can change a role.
drop policy if exists "read_all_profiles" on profiles;
create policy "read_all_profiles" on profiles for select to authenticated using (true);

-- security definer + a fixed search_path so this can be called from a policy
-- on profiles itself without RLS recursing into itself.
create or replace function is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role = 'admin'
  );
$$;

drop policy if exists "admin_manage_profiles" on profiles;
create policy "admin_manage_profiles" on profiles for update to authenticated using (is_admin()) with check (is_admin());

-- New Supabase Auth signups automatically get a profile.
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
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- Backfill profiles for accounts created before this migration ran.
insert into profiles (id, email)
select id, email from auth.users
on conflict (id) do nothing;

-- Which team member a job is assigned to.
alter table jobs add column if not exists assigned_to uuid references profiles(id) on delete set null;
