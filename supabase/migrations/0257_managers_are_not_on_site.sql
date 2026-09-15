-- The person managing a job is not on site.
--
-- jobs.assigned_to is who owns the job: the evaluator at the start, the
-- account manager after. A work day used to count that person as busy for
-- the whole day, so a manager with an eight o'clock evaluation could not
-- have a crew day booked on any job they were assigned to. Now a work day
-- only counts the crew on it, and only the evaluation itself counts the
-- person assigned. Managers can be assigned to as many jobs as they manage.

create or replace function public.assert_visit_free()
returns trigger
language plpgsql
set search_path to 'public'
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
    perform raise_double_booking(person, new.starts_on::timestamptz, (new.ends_on + 1)::timestamptz, new.job_id);
  end loop;
  return new;
end;
$$;

create or replace function public.person_busy_windows(p_profile uuid, p_ignore_job uuid)
returns table(starts timestamptz, ends timestamptz, label text)
language sql
stable security definer
set search_path to 'public'
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
    s.starts_on::timestamptz,
    (s.ends_on + 1)::timestamptz,
    case when (select ours from mine) then coalesce(p.address, 'a job') else 'busy' end
  from job_work_sessions s
  join jobs j on j.id = s.job_id
  left join properties p on p.id = j.property_id
  where s.status <> 'cancelled'
    and j.status <> 'cancelled'
    and (p_ignore_job is null or s.job_id <> p_ignore_job)
    and exists (select 1 from job_crew c where c.job_id = s.job_id and c.profile_id = p_profile)
  union all
  select
    case when d.start_time is null then d.date::timestamptz else (d.date + d.start_time)::timestamptz end,
    case when d.end_time is null then (d.date + 1)::timestamptz else (d.date + d.end_time)::timestamptz end,
    case when (select ours from mine) then 'time off' else 'busy' end
  from availability_days_off d
  where d.profile_id = p_profile;
$$;

revoke execute on function public.person_busy_windows(uuid, uuid) from anon;
