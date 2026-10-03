-- The evaluation email sequence.
--
-- Five emails around a booked evaluation: straight after booking, two days
-- before, the evening before, the morning of, and the evening after. The
-- wording is data, per business, so the office can change a sentence
-- without a deploy. The timing and the safety rules are code, in
-- evaluation_sequence_due(), because "did this already go" is not
-- something to leave to whoever edits the wording.
--
-- Nothing in here sends. evaluation_sequence_due() says what is due right
-- now, fully rendered; evaluation_sequence_claim() writes it down under a
-- unique key before anything goes out, so a sender that runs twice, runs
-- late, or runs twice at once still emails each person each step once.
-- The sender today is the business's own Gmail, driven by a scheduled
-- session; when a sending domain is verified the app's cron can take the
-- same rows through the same door.

create table if not exists evaluation_sequence_steps (
  organization_id uuid not null references organizations(id) on delete cascade,
  step text not null check (step in ('booked', 'two_days', 'day_before', 'morning_of', 'after')),
  enabled boolean not null default true,
  subject text not null,
  body text not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references profiles(id) on delete set null,
  primary key (organization_id, step)
);

alter table evaluation_sequence_steps enable row level security;

drop policy if exists evaluation_sequence_steps_own_org on evaluation_sequence_steps;
create policy evaluation_sequence_steps_own_org on evaluation_sequence_steps
  for all using (organization_id = current_org_id())
  with check (organization_id = current_org_id());

comment on table evaluation_sequence_steps is
  'What each email around a booked evaluation says. A missing row means the default wording, switched on.';

-- The wording a business starts with.
--
-- Placeholders in braces are filled in per client: {first_name}, {when},
-- {day}, {date}, {time}, {address}, {evaluator}, {business}, {phone},
-- {website}. Anything not in that list is left as typed.
create or replace function evaluation_sequence_defaults()
returns table (step text, ordinal int, label text, timing text, subject text, body text)
language sql immutable as $$
  select * from (values
    ('booked', 1, 'Booked', 'Right after they book',
     'You are booked: {day} {date} at {time}',
     E'Hi {first_name},\n\nThanks for booking with us. Here is what is on the calendar:\n\n{when}\n{address}\n\nHere is how the visit works. We walk the property with you, listen to what you want changed and what is bugging you, and take measurements and photos. It usually takes 30 to 45 minutes. You do not need to prepare anything, but it helps a lot if the person making the decision can be there.\n\nAfter the visit you get a written proposal with pricing for each area, so you can pick what to do now and what to leave for later.\n\nIf this time stops working, reply to this email or call or text {phone} and we will move it.\n\nTalk soon,\n{evaluator}\n{business}\n{phone}'),
    ('two_days', 2, 'Two days before', 'Two days before, at 9am',
     'Before we come out {day}: three things that make it worth more',
     E'Hi {first_name},\n\nWe are coming out to {address} on {day} at {time}. Three quick things that make the visit worth a lot more:\n\n1. Walk the yard once before we get there and note what bugs you most. The thing you would fix first is the thing we should price first.\n\n2. Have a rough budget range in mind, even a wide one. It lets us design to what you will actually do rather than guess.\n\n3. If someone else has a say in the decision, try to have them there. Most questions get answered on the spot when everyone is walking the property together.\n\nIf you have photos of yards or ideas you like, reply with them and we will look before we arrive.\n\nSee you {day},\n{evaluator}\n{business}\n{phone}'),
    ('day_before', 3, 'Day before', 'The evening before, at 5pm',
     'Tomorrow at {time}: {evaluator} from {business}',
     E'Hi {first_name},\n\nA quick reminder that {evaluator} is coming out to {address} tomorrow at {time}.\n\nNothing to prepare. If the gate is locked or there is a dog, let us know so we can plan around it.\n\nIf tomorrow no longer works, reply to this email or call or text {phone} today and we will find another time. A heads up is a big help, since we plan the route the night before.\n\nSee you tomorrow,\n{evaluator}\n{business}\n{phone}'),
    ('morning_of', 4, 'Morning of', 'The morning of, at 8am',
     'See you today at {time}',
     E'Hi {first_name},\n\nSee you today at {time} at {address}. If anything changes on your end this morning, text {phone} and we will adjust.\n\n{evaluator}\n{business}'),
    ('after', 5, 'After the visit', 'Three hours after the visit',
     'Thanks for having us out. Here is what happens next',
     E'Hi {first_name},\n\nThanks for walking the property with us today. Here is what happens next:\n\n1. We put your proposal together with pricing for each area we talked about, usually within a day or two.\n\n2. You get a link by email. You can approve the whole thing, pick only some areas, or ask us to change anything.\n\n3. Once you approve, we get you on the schedule and confirm the start date.\n\nIf you thought of anything after we left, or want a quote on something we did not cover, just reply here.\n\nThanks again,\n{evaluator}\n{business}\n{phone}')
  ) as d(step, ordinal, label, timing, subject, body)
$$;

-- Fill the braces in.
create or replace function evaluation_sequence_render(p_template text, p_vars jsonb)
returns text language plpgsql immutable as $$
declare
  k text;
  v text;
  result text := coalesce(p_template, '');
begin
  for k, v in select key, value from jsonb_each_text(p_vars) loop
    result := replace(result, '{' || k || '}', coalesce(v, ''));
  end loop;
  return result;
end
$$;

-- The steps as this business will actually send them: its own wording
-- where it has changed something, the default otherwise.
create or replace function evaluation_sequence_effective()
returns table (step text, ordinal int, label text, timing text, enabled boolean, subject text, body text, custom boolean, updated_at timestamptz)
language sql stable as $$
  select d.step, d.ordinal, d.label, d.timing,
         coalesce(s.enabled, true),
         coalesce(s.subject, d.subject),
         coalesce(s.body, d.body),
         s.step is not null,
         s.updated_at
  from evaluation_sequence_defaults() d
  left join evaluation_sequence_steps s on s.step = d.step and s.organization_id = current_org_id()
  order by d.ordinal
$$;

-- Everything due right now, rendered and addressed.
--
-- Evaluation times are stored the way the booking page wrote them: the
-- wall-clock time of the visit, carried in the UTC field. So the local time
-- is the stored value read as a naive clock, and the true instant is that
-- clock in the business's time zone.
--
-- Each step has a moment and a window. Before the moment it is not due;
-- after the window it is let go, because a "see you tomorrow" that arrives
-- the day after is not a reminder, it is a confusing email. The exception
-- is the booking confirmation, which is welcome for three days.
--
-- A step is skipped when the booking was made after that step's moment,
-- so somebody who books at 2pm for tomorrow does not get "two days before"
-- on top of their confirmation.
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
  select o.id, o.name, o.business_phone, o.business_website,
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
         ((j.evaluation_date at time zone 'UTC') at time zone o.tz) as eval_at
  from orgs o
  join customers c on c.organization_id = o.id
  join properties p on p.customer_id = c.id
  join jobs j on j.property_id = p.id
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
           'website', coalesce(m.business_website, '')
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
       evaluation_sequence_render(w.body_template, w.vars) as body,
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

-- Write a send down before it goes. True means it is yours to send; false
-- means somebody already has it.
create or replace function evaluation_sequence_claim(
  p_organization_id uuid, p_customer_id uuid, p_job_id uuid, p_step text, p_dedupe_key text, p_body text
) returns boolean language plpgsql as $$
declare claimed boolean;
begin
  insert into client_message_log (organization_id, customer_id, channel, kind, reference_id, dedupe_key, status, body, detail)
  values (p_organization_id, p_customer_id, 'email', 'evaluation_' || p_step, p_job_id, p_dedupe_key, 'sent', p_body, 'gmail')
  on conflict (organization_id, dedupe_key) do nothing;
  claimed := found;
  return claimed;
end
$$;

-- What the provider called it, so later steps can thread under the first.
create or replace function evaluation_sequence_sent(p_dedupe_key text, p_message_id text, p_thread_id text)
returns void language sql as $$
  update client_message_log
     set provider_id = p_message_id,
         detail = case when p_thread_id is null then 'gmail' else 'thread:' || p_thread_id end
   where dedupe_key = p_dedupe_key
$$;

-- A claim whose send did not work. Kept, marked, never retried on its own.
create or replace function evaluation_sequence_failed(p_dedupe_key text, p_detail text)
returns void language sql as $$
  update client_message_log
     set status = 'failed', detail = left(coalesce(p_detail, 'send failed'), 500)
   where dedupe_key = p_dedupe_key
$$;

-- These read and write across every business. They are for the service
-- role and the scheduled sender, never for a signed-in browser.
revoke execute on function evaluation_sequence_due(timestamptz) from public, anon, authenticated;
revoke execute on function evaluation_sequence_claim(uuid, uuid, uuid, text, text, text) from public, anon, authenticated;
revoke execute on function evaluation_sequence_sent(text, text, text) from public, anon, authenticated;
revoke execute on function evaluation_sequence_failed(text, text) from public, anon, authenticated;
