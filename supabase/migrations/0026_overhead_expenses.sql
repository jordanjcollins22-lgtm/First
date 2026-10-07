-- Monthly overhead expenses — a private management page, not tied to any
-- job or client. Visible/editable to Jordan's account only (checked by
-- email, not the admin/crew role, since other admins shouldn't see this).

create table if not exists overhead_expenses (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  amount numeric not null,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_updated_at on overhead_expenses;
create trigger set_updated_at before update on overhead_expenses for each row execute function set_updated_at();

alter table overhead_expenses enable row level security;

-- security definer + fixed search_path, same pattern as is_admin() in
-- 0019_roles_and_assignment.sql.
create or replace function is_jordan()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from profiles where id = auth.uid() and email = 'jordanjcollins22@gmail.com'
  );
$$;

drop policy if exists "jordan_manage_overhead" on overhead_expenses;
create policy "jordan_manage_overhead" on overhead_expenses for all to authenticated
  using (is_jordan()) with check (is_jordan());

insert into overhead_expenses (name, amount, note) values
  ('Tesla', 650, null),
  ('Rent', 2700, null),
  ('Insurance', 300, null),
  ('Miscellaneous / Utilities', 650, null);
