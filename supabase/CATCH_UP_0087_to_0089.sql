-- CATCH-UP: everything outstanding, in order, as one paste.
--
-- Run this whole thing in Supabase's SQL Editor. Every statement is
-- idempotent — running it twice is safe, and running it when one of the
-- three is already applied is also safe.
--
-- Generated from the individual files; they remain the source of truth.

-- ==========================================================
-- 0087_referral_outcome.sql
-- ==========================================================
-- Contacting somebody who will never buy from us, on purpose.
--
-- Most of a county is not our target market — small lots, rentals, people who
-- do their own yard. The instinct is to skip them. But the person with the
-- quarter-acre knows the neighbour with the three acres, and asking them is
-- free, so "not for you" is not the end of a call, it is the middle of one.
--
-- That needed an outcome of its own. Logged as "not interested", a call that
-- produced a name looks identical to one that produced nothing, and the whole
-- point of working the rest of the county disappears from the numbers.

alter table outreach_touches drop constraint if exists outreach_touches_outcome_check;
alter table outreach_touches add constraint outreach_touches_outcome_check
  check (outcome in (
    'attempted',
    'reached',
    'interested',
    'booked',
    'referral_received',
    'not_interested',
    'do_not_contact'
  ));

-- Whether this property is one we would ever work at.
--
-- Kept separate from status, which is about our progress with them. A parcel
-- can be out of market and still be worth a call, and conflating the two is
-- how "not our market" turns into "never ring them".
alter table lead_prospects add column if not exists in_target_market boolean;

comment on column lead_prospects.in_target_market is
  'Null until somebody decides. False means we would not work here, which is a reason to ask them who they know rather than a reason to skip them.';

-- Who they pointed us at, when they gave us a name. Free text: a referral is
-- "my sister on Vale Road", not a structured record.
alter table outreach_touches add column if not exists referral_note text;

notify pgrst, 'reload schema';

-- ==========================================================
-- 0088_contact_types.sql
-- ==========================================================
-- Not everybody in the contact book is a client.
--
-- There has only ever been one shelf for a person, and twenty-eight places in
-- the app read a row on it as "a client of ours". That was fine while the only
-- way in was somebody booking an evaluation. It stops being fine the moment a
-- CRM export arrives carrying the stone yard, the tree crew and the realtor
-- who sends work — because they would land in every client picker, every count
-- of our clients, and on the coverage map as somebody we have already sold to.
--
-- So a contact gets a type, and everything that means "our clients" says so
-- explicitly rather than by assuming.

alter table customers add column if not exists contact_type text not null default 'client'
  check (contact_type in ('client', 'lead', 'supplier', 'subcontractor', 'referral_partner', 'other'));

-- Where the row came from, so a bad import can be found and undone whole. The
-- same reasoning as source_batch on the prospect list.
alter table customers add column if not exists source text;
alter table customers add column if not exists import_batch text;

-- The CRM's own id. Re-importing the same export updates rather than
-- duplicating, which matters because nobody imports a contact database once.
alter table customers add column if not exists external_id text;

create unique index if not exists customers_external_id_idx
  on customers(organization_id, external_id)
  where external_id is not null;

-- Kept because losing it is the one mistake that cannot be walked back: a
-- person who opted out of being contacted, contacted again.
alter table customers add column if not exists do_not_contact boolean not null default false;

-- How the CRM organised them. Free-form and preserved as-is, because a tag is
-- somebody's own filing system and re-interpreting it loses information.
alter table customers add column if not exists tags text[];

-- The address as it arrived, before anybody geocoded it.
--
-- A property row needs coordinates, and a CRM address is often partial ("Bel
-- Air, MD") or missing. Rather than making properties.lat nullable and
-- rippling that through every screen that draws a map, the raw text is parked
-- here and a property is created only once it resolves to a real point.
alter table customers add column if not exists import_address text;

create index if not exists customers_contact_type_idx on customers(organization_id, contact_type);

comment on column customers.contact_type is
  'client and lead are people who might buy. supplier, subcontractor and referral_partner are the trade. other is undecided — kept out of client lists until somebody says.';

notify pgrst, 'reload schema';

-- ==========================================================
-- 0089_job_numbers_and_pipeline.sql
-- ==========================================================
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

