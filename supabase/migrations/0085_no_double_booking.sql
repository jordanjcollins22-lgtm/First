-- No double bookings. Ever.
--
-- The app already refuses a clash on all four screens that can cause one, and
-- says which job is in the way. This is the layer underneath that: a rule the
-- database itself holds, so a path nobody thought of — an import, a fix run by
-- hand in the SQL editor, a screen added next year — cannot write one either.
--
-- A check in application code is a promise. A trigger is a guarantee, and the
-- instruction here was "never".
--
-- Note on time: work visits are stored as dates, so the window they occupy is
-- computed in the database's timezone rather than the crew's. For whole-day
-- blocking the two agree in every practical case, and the app-level check runs
-- first with proper local time and a readable message. This is the backstop,
-- not the primary.

create extension if not exists btree_gist;

-- Every commitment a person already has, as windows.
--
-- One function so the three triggers below cannot drift apart about what
-- "busy" means. Excludes one job, because a job must never block itself:
-- moving an appointment an hour later is the commonest thing anybody does on
-- a calendar, and a self-blocking row makes it impossible.
create or replace function person_busy_windows(p_profile uuid, p_ignore_job uuid)
returns table (starts timestamptz, ends timestamptz, label text)
language sql
stable
security definer
set search_path = public
as $$
  -- Evaluations assigned to them.
  select
    j.evaluation_date,
    coalesce(j.evaluation_end_date, j.evaluation_date + interval '60 minutes'),
    coalesce(p.address, 'an evaluation')
  from jobs j
  left join properties p on p.id = j.property_id
  where j.assigned_to = p_profile
    and j.evaluation_date is not null
    and j.status <> 'cancelled'
    and j.evaluation_status <> 'cancelled'
    and (p_ignore_job is null or j.id <> p_ignore_job)

  union all

  -- Work visits on any job they are on, as lead or as crew. A visit books the
  -- whole crew: three people on a patio is three people who cannot take an
  -- evaluation that morning.
  select
    s.starts_on::timestamptz,
    (s.ends_on + 1)::timestamptz,
    coalesce(p.address, 'a job')
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

  -- Time off. A whole-day row has no times on it.
  select
    case when d.start_time is null then d.date::timestamptz
         else (d.date + d.start_time)::timestamptz end,
    case when d.end_time is null then (d.date + 1)::timestamptz
         else (d.date + d.end_time)::timestamptz end,
    'time off'
  from availability_days_off d
  where d.profile_id = p_profile;
$$;

-- The shared refusal, so all three triggers say the same thing the same way.
create or replace function raise_double_booking(p_profile uuid, p_starts timestamptz, p_ends timestamptz, p_ignore_job uuid)
returns void
language plpgsql
stable
as $$
declare
  clash record;
  who text;
begin
  select * into clash
  from person_busy_windows(p_profile, p_ignore_job) w
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

-- 1. Evaluations on the job row.
create or replace function assert_evaluation_free() returns trigger
language plpgsql
as $$
begin
  if new.assigned_to is null
     or new.evaluation_date is null
     or new.status = 'cancelled'
     or new.evaluation_status = 'cancelled' then
    return new;
  end if;

  -- Nothing moved that matters. Lets a status change, a rename, or a note
  -- save without re-running the check.
  if tg_op = 'UPDATE'
     and old.assigned_to is not distinct from new.assigned_to
     and old.evaluation_date is not distinct from new.evaluation_date
     and old.evaluation_end_date is not distinct from new.evaluation_end_date
     and old.status is not distinct from new.status
     and old.evaluation_status is not distinct from new.evaluation_status then
    return new;
  end if;

  perform raise_double_booking(
    new.assigned_to,
    new.evaluation_date,
    coalesce(new.evaluation_end_date, new.evaluation_date + interval '60 minutes'),
    new.id
  );
  return new;
end;
$$;

drop trigger if exists no_double_booked_evaluation on jobs;
create trigger no_double_booked_evaluation
  before insert or update on jobs
  for each row execute function assert_evaluation_free();

-- 2. Work visits, checked against every person on the job.
create or replace function assert_visit_free() returns trigger
language plpgsql
as $$
declare
  person uuid;
begin
  if new.status = 'cancelled' then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and old.starts_on is not distinct from new.starts_on
     and old.ends_on is not distinct from new.ends_on
     and old.status is not distinct from new.status then
    return new;
  end if;

  for person in
    select c.profile_id from job_crew c where c.job_id = new.job_id
    union
    select j.assigned_to from jobs j where j.id = new.job_id and j.assigned_to is not null
  loop
    perform raise_double_booking(
      person,
      new.starts_on::timestamptz,
      (new.ends_on + 1)::timestamptz,
      new.job_id
    );
  end loop;

  return new;
end;
$$;

drop trigger if exists no_double_booked_visit on job_work_sessions;
create trigger no_double_booked_visit
  before insert or update on job_work_sessions
  for each row execute function assert_visit_free();

-- 3. Putting somebody on a job that already has days on the calendar.
create or replace function assert_crew_free() returns trigger
language plpgsql
as $$
declare
  starts date;
  ends date;
begin
  select j.project_start_date, coalesce(j.project_end_date, j.project_start_date)
    into starts, ends
  from jobs j where j.id = new.job_id;

  -- A job with no dates books nobody's time. The office picks a crew and then
  -- finds them a week as often as the other way round, and refusing that would
  -- stop the normal order of things.
  if starts is null then
    return new;
  end if;

  perform raise_double_booking(new.profile_id, starts::timestamptz, (ends + 1)::timestamptz, new.job_id);
  return new;
end;
$$;

drop trigger if exists no_double_booked_crew on job_crew;
create trigger no_double_booked_crew
  before insert on job_crew
  for each row execute function assert_crew_free();

notify pgrst, 'reload schema';
