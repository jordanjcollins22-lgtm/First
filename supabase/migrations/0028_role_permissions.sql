-- Lets admins control which tabs/pages each role can see, instead of every
-- signed-in account reaching every page. A tab is visible if ANY of a
-- person's roles grants it. Admins always see everything regardless of
-- what's configured here, so misconfiguring this table can't lock an admin
-- out of fixing it.

create table if not exists role_permissions (
  role_name text not null references roles(name) on delete cascade on update cascade,
  tab_key text not null,
  created_at timestamptz not null default now(),
  primary key (role_name, tab_key)
);

alter table role_permissions enable row level security;

drop policy if exists "read_all_role_permissions" on role_permissions;
create policy "read_all_role_permissions" on role_permissions for select to authenticated using (true);

drop policy if exists "admin_manage_role_permissions" on role_permissions;
create policy "admin_manage_role_permissions" on role_permissions for all to authenticated
  using (is_admin()) with check (is_admin());

-- Seed with today's actual access so nothing regresses: admin and crew both
-- currently reach every one of these pages.
insert into role_permissions (role_name, tab_key)
select r.role_name, t.tab_key
from (values ('admin'), ('crew')) as r(role_name)
cross join (values ('new-property'), ('project-data'), ('tools'), ('materials'), ('services'), ('team')) as t(tab_key)
on conflict do nothing;
