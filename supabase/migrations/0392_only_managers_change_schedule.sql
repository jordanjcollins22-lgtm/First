-- Only the account manager and up (owner, admin, office, account manager,
-- location partner) can change the crew schedule: adding or removing a work
-- day, moving its dates, its crew, or its order, and moving a job's dates.
-- Server code with the service key (no signed-in user) and changes made by
-- other triggers are let through, so public booking and the job-window sync
-- keep working. Crew progress (status, arrival, finish) stays open to the crew.

create or replace function public.can_change_schedule()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is null
      or exists (
        select 1 from profile_roles r
        where r.profile_id = auth.uid()
          and lower(replace(r.role_name, '-', ' ')) in ('owner', 'admin', 'office', 'account manager', 'location partner')
      );
$$;

create or replace function public.guard_visit_schedule()
returns trigger
language plpgsql
as $$
begin
  if pg_trigger_depth() > 1 or public.can_change_schedule() then
    return coalesce(new, old);
  end if;
  if tg_op = 'INSERT' or tg_op = 'DELETE'
     or new.starts_on is distinct from old.starts_on
     or new.ends_on is distinct from old.ends_on
     or new.crew_lead_id is distinct from old.crew_lead_id
     or new.stop_order is distinct from old.stop_order
     or new.route_locked is distinct from old.route_locked
     or (new.status = 'cancelled' and old.status is distinct from 'cancelled') then
    raise exception 'Only the account manager or the owner can change the schedule.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_visit_schedule on job_work_sessions;
create trigger guard_visit_schedule before insert or update or delete on job_work_sessions
  for each row execute function public.guard_visit_schedule();

create or replace function public.guard_job_dates()
returns trigger
language plpgsql
as $$
begin
  if pg_trigger_depth() > 1 or public.can_change_schedule() then
    return new;
  end if;
  if new.project_start_date is distinct from old.project_start_date
     or new.project_end_date is distinct from old.project_end_date then
    raise exception 'Only the account manager or the owner can change the schedule.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_job_dates on jobs;
create trigger guard_job_dates before update on jobs
  for each row execute function public.guard_job_dates();
