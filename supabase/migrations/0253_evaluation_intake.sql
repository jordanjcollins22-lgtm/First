-- The pre-evaluation form.
--
-- Before we drive out, the client tells us what they want done, the colours
-- and looks they like, what they have tried before, and what would make
-- them say no. It is a link in the booking emails; if they never open it,
-- the evaluator goes through the same questions with them in the first five
-- to ten minutes of the visit, on the same page, so the answers land in the
-- same place either way.
--
-- One row per evaluation, made the moment a job gets an evaluation date, so
-- the link exists before the first email needs it. The token is the only
-- thing the public page knows; there is no sign-in and nothing else on it.

create table if not exists evaluation_intakes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  job_id uuid not null unique references jobs(id) on delete cascade,
  token text not null unique default encode(gen_random_bytes(12), 'hex'),
  answers jsonb not null default '{}'::jsonb,
  -- Null until they press Send. Answers can be saved before that.
  submitted_at timestamptz,
  -- 'client' when they did it themselves, 'together' when it was done at the door.
  submitted_by text check (submitted_by in ('client', 'together')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists evaluation_intakes_org_idx on evaluation_intakes (organization_id, submitted_at desc);

alter table evaluation_intakes enable row level security;

drop policy if exists evaluation_intakes_own_org on evaluation_intakes;
create policy evaluation_intakes_own_org on evaluation_intakes
  for all using (organization_id = current_org_id())
  with check (organization_id = current_org_id());

comment on table evaluation_intakes is
  'What the client told us before the evaluation: services, looks, what they tried, what would stop them. One per evaluation, reached by token.';

-- Where the public pages live, so an email can carry a link to one.
alter table organizations add column if not exists public_base_url text;
comment on column organizations.public_base_url is
  'The origin the client-facing pages are served from, like https://app.example.com. Emails built in the database use it for links.';

-- Every evaluation gets a form the moment it has a date.
create or replace function ensure_evaluation_intake() returns trigger language plpgsql as $$
declare org uuid;
begin
  if new.evaluation_date is null then return new; end if;
  select c.organization_id into org
    from properties p join customers c on c.id = p.customer_id
   where p.id = new.property_id;
  if org is null then return new; end if;
  insert into evaluation_intakes (organization_id, job_id)
  values (org, new.id)
  on conflict (job_id) do nothing;
  return new;
end
$$;

drop trigger if exists jobs_ensure_evaluation_intake on jobs;
create trigger jobs_ensure_evaluation_intake
  after insert or update of evaluation_date on jobs
  for each row execute function ensure_evaluation_intake();

-- The evaluations already on the calendar get one too.
insert into evaluation_intakes (organization_id, job_id)
select c.organization_id, j.id
  from jobs j
  join properties p on p.id = j.property_id
  join customers c on c.id = p.customer_id
 where j.evaluation_date is not null
   and j.evaluation_date > now() - interval '3 days'
   and j.cancelled_at is null
on conflict (job_id) do nothing;

-- The emails now point at the form.
--
-- {prep_link} is the form's address. {prep_line} is a sentence that depends
-- on whether they have filled it in: a nudge with the link if not, a thank
-- you if so, and nothing at all if this evaluation has no form.
create or replace function evaluation_sequence_defaults()
returns table (step text, ordinal int, label text, timing text, subject text, body text)
language sql immutable as $$
  select * from (values
    ('booked', 1, 'Booked', 'Right after they book',
     'You are booked: {day} {date} at {time}',
     E'Hi {first_name},\n\nThanks for booking with us. Here is what is on the calendar:\n\n{when}\n{address}\n\nOne thing before we come out. There is a short form, about five minutes, that asks what you want done, the colours and looks you like, what you have tried before, and anything that would give you pause:\n\n{prep_link}\n\nIt is worth doing before the visit, because it lets us come ready with ideas instead of using the visit to find out what you are after. If you do not get to it, no problem. We will go through it together in the first five to ten minutes of the appointment.\n\nHere is how the visit works. We walk the property with you, listen to what you want changed and what is bugging you, and take measurements and photos. It usually takes 30 to 45 minutes. It helps a lot if the person making the decision can be there.\n\nAfter the visit you get a written proposal with pricing for each area, so you can pick what to do now and what to leave for later.\n\nIf this time stops working, reply to this email or call or text {phone} and we will move it.\n\nTalk soon,\n{evaluator}\n{business}\n{phone}'),
    ('two_days', 2, 'Two days before', 'Two days before, at 9am',
     'Before we come out {day}: three things that make it worth more',
     E'Hi {first_name},\n\nWe are coming out to {address} on {day} at {time}. Three quick things that make the visit worth a lot more:\n\n1. Walk the yard once before we get there and note what bugs you most. The thing you would fix first is the thing we should price first.\n\n2. Have a rough budget range in mind, even a wide one. It lets us design to what you will actually do rather than guess.\n\n3. If someone else has a say in the decision, try to have them there. Most questions get answered on the spot when everyone is walking the property together.\n\n{prep_line}\n\nIf you have photos of yards or ideas you like, reply with them and we will look before we arrive.\n\nSee you {day},\n{evaluator}\n{business}\n{phone}'),
    ('day_before', 3, 'Day before', 'The evening before, at 5pm',
     'Tomorrow at {time}: {evaluator} from {business}',
     E'Hi {first_name},\n\nA quick reminder that {evaluator} is coming out to {address} tomorrow at {time}.\n\n{prep_line}\n\nIf the gate is locked or there is a dog, let us know so we can plan around it.\n\nIf tomorrow no longer works, reply to this email or call or text {phone} today and we will find another time. A heads up is a big help, since we plan the route the night before.\n\nSee you tomorrow,\n{evaluator}\n{business}\n{phone}'),
    ('morning_of', 4, 'Morning of', 'The morning of, at 8am',
     'See you today at {time}',
     E'Hi {first_name},\n\nSee you today at {time} at {address}. If anything changes on your end this morning, text {phone} and we will adjust.\n\n{evaluator}\n{business}'),
    ('after', 5, 'After the visit', 'Three hours after the visit',
     'Thanks for having us out. Here is what happens next',
     E'Hi {first_name},\n\nThanks for walking the property with us today. Here is what happens next:\n\n1. We put your proposal together with pricing for each area we talked about, usually within a day or two.\n\n2. You get a link by email. You can approve the whole thing, pick only some areas, or ask us to change anything.\n\n3. Once you approve, we get you on the schedule and confirm the start date.\n\nIf you thought of anything after we left, or want a quote on something we did not cover, just reply here.\n\nThanks again,\n{evaluator}\n{business}\n{phone}')
  ) as d(step, ordinal, label, timing, subject, body)
$$;

create or replace function evaluation_sequence_due(p_now timestamptz default now())
returns table (
  organization_id uuid,
  job_id uuid,
  customer_id uuid,
  step text,
  dedupe_key text,
  to_email text,
  to_name text,
  subject text,
  body text,
  reply_thread_id text,
  fire_at timestamptz,
  evaluation_at timestamptz,
  local_when text
)
language sql stable as $$
with orgs as (
  select o.id, o.name, o.business_phone, o.business_website, o.public_base_url,
         o.reminder_time_zone as tz, o.reminder_quiet_start as quiet_start, o.reminder_quiet_end as quiet_end,
         (select initcap(split_part(trim(pr.full_name), ' ', 1))
            from profiles pr
           where pr.organization_id = o.id and o.business_email is not null and lower(pr.email) = lower(o.business_email)
           limit 1) as contact_first
  from organizations o
  where o.client_reminders_enabled
),
evals as (
  select o.*,
         j.id as job_id, j.created_at as booked_at, j.assigned_to,
         c.id as cust_id, c.name as cust_name, c.email as cust_email,
         p.address,
         (j.evaluation_date at time zone 'UTC') as local_naive,
         ((j.evaluation_date at time zone 'UTC') at time zone o.tz) as eval_at,
         i.token as prep_token,
         i.submitted_at as prep_submitted_at
  from orgs o
  join customers c on c.organization_id = o.id
  join properties p on p.customer_id = c.id
  join jobs j on j.property_id = p.id
  left join evaluation_intakes i on i.job_id = j.id
  where j.evaluation_date is not null
    and j.cancelled_at is null
    and j.evaluation_status <> 'cancelled'
    and not coalesce(c.do_not_contact, false)
    and c.email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
    and j.evaluation_date > p_now - interval '3 days'
    and j.evaluation_date < p_now + interval '60 days'
    and not exists (
      select 1 from client_consent cc
      where cc.customer_id = c.id and cc.channel = 'email' and cc.state = 'revoked'
    )
),
moments as (
  select e.*, s.step, s.fire_at, s.until
  from evals e
  cross join lateral (values
    ('booked',
      e.booked_at,
      least(e.booked_at + interval '72 hours', e.eval_at)),
    ('two_days',
      ((e.local_naive::date - 2) + time '09:00') at time zone e.tz,
      (((e.local_naive::date - 2) + time '09:00') at time zone e.tz) + interval '4 hours'),
    ('day_before',
      ((e.local_naive::date - 1) + time '17:00') at time zone e.tz,
      (((e.local_naive::date - 1) + time '17:00') at time zone e.tz) + interval '4 hours'),
    ('morning_of',
      (e.local_naive::date + time '08:00') at time zone e.tz,
      least(((e.local_naive::date + time '08:00') at time zone e.tz) + interval '3 hours', e.eval_at - interval '20 minutes')),
    ('after',
      e.eval_at + interval '3 hours',
      e.eval_at + interval '23 hours')
  ) as s(step, fire_at, until)
  where p_now >= s.fire_at
    and p_now < s.until
    and (s.step = 'booked' or e.booked_at < s.fire_at)
    -- Quiet hours: held, and back next run.
    and extract(hour from p_now at time zone e.tz) >= e.quiet_start
    and extract(hour from p_now at time zone e.tz) < e.quiet_end
),
worded as (
  select m.*,
         coalesce(t.enabled, true) as enabled,
         coalesce(t.subject, d.subject) as subject_template,
         coalesce(t.body, d.body) as body_template,
         jsonb_build_object(
           'first_name', coalesce(nullif(initcap(split_part(trim(m.cust_name), ' ', 1)), ''), 'there'),
           'when', to_char(m.local_naive, 'FMDay, FMMonth FMDD') || ' at ' || lower(to_char(m.local_naive, 'FMHH12:MI am')),
           'day', to_char(m.local_naive, 'FMDay'),
           'date', to_char(m.local_naive, 'FMMonth FMDD'),
           'time', lower(to_char(m.local_naive, 'FMHH12:MI am')),
           'address', regexp_replace(coalesce(m.address, ''), ',\s*(Maryland|MD)\M.*$', ''),
           'evaluator', coalesce(
             (select nullif(initcap(split_part(trim(pr.full_name), ' ', 1)), '') from profiles pr where pr.id = m.assigned_to),
             m.contact_first,
             'our evaluator'),
           'business', m.name,
           'phone', coalesce(m.business_phone, ''),
           'website', coalesce(m.business_website, ''),
           'prep_link', case when m.prep_token is null then ''
             else coalesce(rtrim(m.public_base_url, '/'), '') || '/prep/' || m.prep_token end,
           'prep_line', case
             when m.prep_token is null then ''
             when m.prep_submitted_at is not null then 'Thanks for filling in the form. We have read it and will come ready.'
             else E'If you have not had a chance to fill in the short form yet, it is here:\n\n'
               || coalesce(rtrim(m.public_base_url, '/'), '') || '/prep/' || m.prep_token
               || E'\n\nIt takes about five minutes. If you do not get to it, we will go through it together in the first five to ten minutes of the visit.'
           end
         ) as vars
  from moments m
  join evaluation_sequence_defaults() d on d.step = m.step
  left join evaluation_sequence_steps t on t.organization_id = m.id and t.step = m.step
)
select w.id as organization_id,
       w.job_id,
       w.cust_id as customer_id,
       w.step,
       'evaluation_sequence:' || w.job_id || ':' || w.step || ':email' as dedupe_key,
       w.cust_email as to_email,
       w.cust_name as to_name,
       evaluation_sequence_render(w.subject_template, w.vars) as subject,
       -- A {prep_line} that rendered to nothing leaves a double blank line behind.
       regexp_replace(evaluation_sequence_render(w.body_template, w.vars), E'\n{3,}', E'\n\n', 'g') as body,
       (select substring(l.detail from 'thread:(\S+)')
          from client_message_log l
         where l.organization_id = w.id and l.reference_id = w.job_id
           and l.channel = 'email' and l.status = 'sent' and l.detail like 'thread:%'
         order by l.created_at
         limit 1) as reply_thread_id,
       w.fire_at,
       w.eval_at as evaluation_at,
       w.vars ->> 'when' as local_when
from worded w
where w.enabled
  and not exists (
    select 1 from client_message_log l
    where l.organization_id = w.id
      and l.dedupe_key = 'evaluation_sequence:' || w.job_id || ':' || w.step || ':email'
  )
order by w.fire_at, w.job_id
$$;

revoke execute on function evaluation_sequence_due(timestamptz) from public, anon, authenticated;
