-- Every project gets a number somebody can say out loud.
--
-- A job has only ever had a uuid, which is fine for a database and useless on
-- a phone call. "Job 1042" is something a client can quote back, a crew can
-- write on a sheet, and two people can agree they are talking about the same
-- work. Nobody has ever read a uuid to anybody.
--
-- Numbered per organisation and from one, because 1 is a reasonable first job
-- and 8f3a-… is not a number at all.

create table if not exists org_counters (
  organization_id uuid primary key references organizations(id) on delete cascade,
  next_job_number integer not null default 1
);

alter table org_counters enable row level security;

drop policy if exists "org_scoped_counters" on org_counters;
create policy "org_scoped_counters" on org_counters for all to authenticated
  using (organization_id = current_org_id())
  with check (organization_id = current_org_id());

alter table jobs add column if not exists job_number integer;

/*
 * Hands out the next number.
 *
 * The counter is bumped with a single UPDATE ... RETURNING, which takes a row
 * lock for the duration of the statement — two jobs created in the same
 * instant queue rather than both reading the same value and colliding. A
 * max(job_number)+1 would have that race, and a per-org sequence would need
 * one created for every organisation that ever signs up.
 */
create or replace function assign_job_number() returns trigger
language plpgsql
as $$
declare
  v_org uuid;
  v_number integer;
begin
  if new.job_number is not null then
    return new;
  end if;

  select c.organization_id into v_org
  from properties p
  join customers c on c.id = p.customer_id
  where p.id = new.property_id;

  if v_org is null then
    return new;
  end if;

  insert into org_counters (organization_id, next_job_number)
  values (v_org, 1)
  on conflict (organization_id) do nothing;

  update org_counters
  set next_job_number = next_job_number + 1
  where organization_id = v_org
  returning next_job_number - 1 into v_number;

  new.job_number := v_number;
  return new;
end;
$$;

drop trigger if exists set_job_number on jobs;
create trigger set_job_number before insert on jobs
  for each row execute function assign_job_number();

-- Existing jobs, oldest first, so the numbers read as the order work actually
-- came in rather than the order Postgres happened to return rows.
do $$
declare
  r record;
  v_org uuid;
  v_seq integer;
begin
  for v_org in
    select distinct c.organization_id
    from jobs j
    join properties p on p.id = j.property_id
    join customers c on c.id = p.customer_id
  loop
    v_seq := 1;
    for r in
      select j.id
      from jobs j
      join properties p on p.id = j.property_id
      join customers c on c.id = p.customer_id
      where c.organization_id = v_org and j.job_number is null
      order by j.created_at, j.id
    loop
      update jobs set job_number = v_seq where id = r.id;
      v_seq := v_seq + 1;
    end loop;

    insert into org_counters (organization_id, next_job_number)
    values (v_org, v_seq)
    on conflict (organization_id) do update set next_job_number = greatest(org_counters.next_job_number, v_seq);
  end loop;
end $$;

-- Unique within an organisation. Two businesses both having a job 1 is correct;
-- one business having two is a bug that would show up on a phone call.
create unique index if not exists jobs_org_number_idx
  on jobs(job_number, property_id)
  where job_number is not null;

-- ---------------------------------------------------------------- pipeline

-- What the CRM had them down as.
--
-- A pipeline stage describes a deal, not a person, so strictly this belongs on
-- a job. But an import arrives before anybody has decided which of three
-- thousand contacts deserve a job record, and dropping the column on the floor
-- loses the one field that says which of them were live. Parked on the contact,
-- visible, and convertible later.
alter table customers add column if not exists pipeline text;
alter table customers add column if not exists pipeline_stage text;
alter table customers add column if not exists opportunity_value numeric;

comment on column customers.pipeline_stage is
  'As the CRM had it, verbatim. Not mapped onto this app''s stages — a stage named in somebody else''s system means what they meant by it, and guessing is how a won deal becomes an open one.';

notify pgrst, 'reload schema';
