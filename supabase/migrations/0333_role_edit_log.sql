-- Every change to a role, with who made it and when.
--
-- A role is three things: that it exists (roles), what it can open
-- (role_permissions), and who has it (profile_roles). A trigger on each writes
-- a line here whatever screen, action or script made the change, so the log
-- cannot miss one. Append-only: nobody can edit or delete a line, including
-- admins, because a log somebody can tidy is not a log.

create table if not exists public.role_edit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  role_name text not null,
  -- created, renamed, deleted, permission_granted, permission_removed,
  -- person_added, person_removed
  action text not null,
  -- The tab, or the person, or the old name.
  subject text,
  detail jsonb,
  -- Who did it: the signed-in account, never the one being viewed as. Null
  -- when the database itself did it (a migration or a script).
  actor uuid,
  actor_name text
);

create index if not exists role_edit_log_role_at on public.role_edit_log (role_name, at desc);

alter table public.role_edit_log enable row level security;
drop policy if exists role_edit_log_read on public.role_edit_log;
create policy role_edit_log_read on public.role_edit_log for select to authenticated
  using ((select is_admin()));
-- No insert, update or delete policies: only the triggers below write, and
-- nothing rewrites history.

create or replace function public.log_role_edit()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  who uuid := auth.uid();
  who_name text;
  person text;
begin
  if who is not null then
    select coalesce(nullif(trim(full_name), ''), email) into who_name from profiles where id = who;
  end if;

  if tg_table_name = 'roles' then
    if tg_op = 'INSERT' then
      insert into role_edit_log (role_name, action, actor, actor_name) values (new.name, 'created', who, who_name);
    elsif tg_op = 'DELETE' then
      insert into role_edit_log (role_name, action, actor, actor_name) values (old.name, 'deleted', who, who_name);
    elsif new.name is distinct from old.name then
      insert into role_edit_log (role_name, action, subject, actor, actor_name) values (new.name, 'renamed', old.name, who, who_name);
    end if;

  elsif tg_table_name = 'role_permissions' then
    if tg_op = 'DELETE' then
      insert into role_edit_log (role_name, action, subject, actor, actor_name) values (old.role_name, 'permission_removed', old.tab_key, who, who_name);
    elsif tg_op = 'INSERT' then
      insert into role_edit_log (role_name, action, subject, actor, actor_name)
      values (new.role_name, case when coalesce(new.granted, true) then 'permission_granted' else 'permission_removed' end, new.tab_key, who, who_name);
    elsif new.granted is distinct from old.granted then
      insert into role_edit_log (role_name, action, subject, actor, actor_name)
      values (new.role_name, case when coalesce(new.granted, true) then 'permission_granted' else 'permission_removed' end, new.tab_key, who, who_name);
    end if;

  elsif tg_table_name = 'profile_roles' then
    select coalesce(nullif(trim(full_name), ''), email) into person
    from profiles where id = case when tg_op = 'DELETE' then old.profile_id else new.profile_id end;
    if tg_op = 'INSERT' then
      insert into role_edit_log (role_name, action, subject, detail, actor, actor_name)
      values (new.role_name, 'person_added', person, jsonb_build_object('profileId', new.profile_id), who, who_name);
    elsif tg_op = 'DELETE' then
      insert into role_edit_log (role_name, action, subject, detail, actor, actor_name)
      values (old.role_name, 'person_removed', person, jsonb_build_object('profileId', old.profile_id), who, who_name);
    elsif new.role_name is distinct from old.role_name then
      insert into role_edit_log (role_name, action, subject, detail, actor, actor_name)
      values (old.role_name, 'person_removed', person, jsonb_build_object('profileId', old.profile_id), who, who_name),
             (new.role_name, 'person_added', person, jsonb_build_object('profileId', new.profile_id), who, who_name);
    end if;
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists log_role_edit on public.roles;
create trigger log_role_edit after insert or update or delete on public.roles
  for each row execute function public.log_role_edit();

drop trigger if exists log_role_edit on public.role_permissions;
create trigger log_role_edit after insert or update or delete on public.role_permissions
  for each row execute function public.log_role_edit();

drop trigger if exists log_role_edit on public.profile_roles;
create trigger log_role_edit after insert or update or delete on public.profile_roles
  for each row execute function public.log_role_edit();
