-- Two last ways one business could reach into another.
--
-- person_busy_windows says when somebody is booked, and the public booking
-- page needs it: a client picking a slot has to know which ones are taken,
-- and that page has no login. But it answered for any person whose id was
-- passed, and it labelled every window with the client's address. So a
-- stranger holding a booking link, or a signed-in person at the other
-- business, could read a whole evaluator's diary with the addresses of the
-- people on it.
--
-- The times still come back for anyone, because booking depends on them.
-- The address only comes back to somebody at that person's own business.
-- Everybody else is told "busy", which is all a client picking a slot ever
-- needed to know.
--
-- And gis_import_tick nudges every running county import, whichever
-- business it belongs to, at the address that business recorded. It is for
-- the scheduler and nobody else, so it is no longer callable with a login.

CREATE OR REPLACE FUNCTION public.person_busy_windows(p_profile uuid, p_ignore_job uuid)
RETURNS TABLE(starts timestamp with time zone, ends timestamp with time zone, label text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
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
    and (
      j.assigned_to = p_profile
      or exists (select 1 from job_crew c where c.job_id = s.job_id and c.profile_id = p_profile)
    )
  union all
  select
    case when d.start_time is null then d.date::timestamptz else (d.date + d.start_time)::timestamptz end,
    case when d.end_time is null then (d.date + 1)::timestamptz else (d.date + d.end_time)::timestamptz end,
    case when (select ours from mine) then 'time off' else 'busy' end
  from availability_days_off d
  where d.profile_id = p_profile;
$function$;

REVOKE ALL ON FUNCTION public.gis_import_tick() FROM PUBLIC, anon, authenticated;
