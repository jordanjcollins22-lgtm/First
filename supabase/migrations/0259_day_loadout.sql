-- One person, several jobs, one trip to the shop.
--
-- Two things change. A crew member can now be on more than one job in a
-- day: the double-booking rule for crew used to count every work day they
-- were on, so putting Shalon on three jobs that all run today was refused
-- as a clash with himself. Now the only things that stop somebody being put
-- on a work day are an evaluation they are running and time off. Work days
-- overlap freely; the schedule engine orders the stops.
--
-- And every visit can say what to bring: which kits, which loose tools, and
-- which materials. The crew's day screen adds those up across every stop
-- and shows one load-out list to tick off at the shop, so the second job of
-- the day is not the one that gets left without a dolly.

-- ---------------------------------------------------------------------------
-- 1. Crew clash only with things that are not other work days.
-- ---------------------------------------------------------------------------
create or replace function public.person_fixed_windows(p_profile uuid, p_ignore_job uuid)
returns table(starts timestamptz, ends timestamptz, label text)
language sql
stable security definer
set search_path = public, extensions
as $$
  with mine as (
    select (select organization_id from profiles where id = p_profile) = current_org_id() as ours
  )
  select
    j.evaluation_date,
    coalesce(j.evaluation_end_date, j.evaluation_date + interval '60 minutes'),
    case when (select ours from mine) then coalesce(p.address, 'an evaluation') else 'busy' end
  from jobs j
  left join properties p on p.id = j.property_id
  where j.assigned_to = p_profile
    and j.evaluation_date is not null
    and j.status <> 'cancelled'
    and j.evaluation_status <> 'cancelled'
    and (p_ignore_job is null or j.id <> p_ignore_job)
  union all
  select
    case when d.start_time is null then d.date::timestamptz else (d.date + d.start_time)::timestamptz end,
    case when d.end_time is null then (d.date + 1)::timestamptz else (d.date + d.end_time)::timestamptz end,
    case when (select ours from mine) then 'time off' else 'busy' end
  from availability_days_off d
  where d.profile_id = p_profile;
$$;

revoke execute on function public.person_fixed_windows(uuid, uuid) from anon, public;

create or replace function public.raise_work_clash(p_profile uuid, p_starts timestamptz, p_ends timestamptz, p_ignore_job uuid)
returns void
language plpgsql
stable
set search_path = public, extensions
as $$
declare
  clash record;
  who text;
begin
  select * into clash
  from person_fixed_windows(p_profile, p_ignore_job) w
  where tstzrange(w.starts, w.ends) && tstzrange(p_starts, p_ends)
  limit 1;

  if found then
    select coalesce(full_name, email) into who from profiles where id = p_profile;
    raise exception
      'Double booking: % is already committed to % from % to %.',
      coalesce(who, 'that person'), clash.label, clash.starts, clash.ends
      using errcode = 'exclusion_violation';
  end if;
end;
$$;

revoke execute on function public.raise_work_clash(uuid, timestamptz, timestamptz, uuid) from anon, public;

create or replace function public.assert_crew_free()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
declare
  starts date;
  ends date;
begin
  select j.project_start_date, coalesce(j.project_end_date, j.project_start_date)
    into starts, ends
  from jobs j where j.id = new.job_id;

  if starts is null then
    return new;
  end if;

  perform raise_work_clash(new.profile_id, starts::timestamptz, (ends + 1)::timestamptz, new.job_id);
  return new;
end;
$$;

create or replace function public.assert_visit_free()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
declare person uuid;
begin
  if new.status = 'cancelled' then return new; end if;

  if tg_op = 'UPDATE'
     and old.starts_on is not distinct from new.starts_on
     and old.ends_on is not distinct from new.ends_on
     and old.status is not distinct from new.status then
    return new;
  end if;

  for person in
    select c.profile_id from job_crew c where c.job_id = new.job_id
  loop
    perform raise_work_clash(person, new.starts_on::timestamptz, (new.ends_on + 1)::timestamptz, new.job_id);
  end loop;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. What a visit needs brought.
-- ---------------------------------------------------------------------------
alter table job_work_sessions
  add column if not exists kits integer[] not null default '{}',
  add column if not exists tool_ids uuid[] not null default '{}',
  add column if not exists materials text[] not null default '{}';

comment on column job_work_sessions.kits is 'Kit numbers to load for this visit.';
comment on column job_work_sessions.tool_ids is 'Loose tools to load, outside any kit.';
comment on column job_work_sessions.materials is 'Materials to load, by name, free text.';

-- ---------------------------------------------------------------------------
-- 3. What got loaded, ticked at the shop.
-- ---------------------------------------------------------------------------
create table if not exists loadout_checks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  day date not null,
  item_kind text not null check (item_kind in ('kit', 'tool', 'material')),
  item_key text not null,
  checked_at timestamptz not null default now(),
  unique (profile_id, day, item_kind, item_key)
);

create index if not exists loadout_checks_org_day_idx on loadout_checks(organization_id, day);

alter table loadout_checks enable row level security;

drop policy if exists "loadout_checks_own_write" on loadout_checks;
create policy "loadout_checks_own_write" on loadout_checks for all to authenticated
  using (organization_id = current_org_id() and profile_id = auth.uid())
  with check (organization_id = current_org_id() and profile_id = auth.uid());

drop policy if exists "loadout_checks_office_read" on loadout_checks;
create policy "loadout_checks_office_read" on loadout_checks for select to authenticated
  using (
    organization_id = current_org_id()
    and exists (
      select 1 from profile_roles pr
      where pr.profile_id = auth.uid() and pr.role_name in ('admin', 'owner', 'overhead')
    )
  );
