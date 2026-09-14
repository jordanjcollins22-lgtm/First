-- A video walkthrough is not a visit, and the emails should not say it is.
--
-- Outside Harford County the evaluation is a video call. The reminder
-- sequence said "we are coming out to" everybody. The lines that describe
-- the appointment are now filled in by the kind of evaluation on the job,
-- and the defaults use those placeholders. Wording anybody has customised
-- is left as it is.

create or replace function evaluation_sequence_defaults()
returns table (step text, ordinal int, label text, timing text, subject text, body text)
language sql immutable
set search_path = public, extensions
as $$
  select * from (values
    ('booked', 1, 'Booked', 'Right after they book',
     'You are booked: {day} {date} at {time}',
     E'Hi {first_name},\n\nThanks for booking with us. Here is what is on the calendar:\n\n{when}\n{address}\n\nOne thing before then. There is a short form, about five minutes, that asks what you want done, the colours and looks you like, what you have tried before, and anything that would give you pause:\n\n{prep_link}\n\nIt is worth doing before the visit, because it lets us come ready with ideas instead of using the visit to find out what you are after. If you do not get to it, no problem. We will go through it together in the first five to ten minutes of the appointment.\n\n{how_it_works}\n\nAfter the visit you get a written proposal with pricing for each area, so you can pick what to do now and what to leave for later.\n\nIf this time stops working, reply to this email or call or text {phone} and we will move it.\n\nTalk soon,\n{evaluator}\n{business}\n{phone}'),
    ('two_days', 2, 'Two days before', 'Two days before, at 9am',
     '{before_we} {day}: three things that make it worth more',
     E'Hi {first_name},\n\n{coming} Three quick things that make the visit worth a lot more:\n\n1. Walk the yard once before we get there and note what bugs you most. The thing you would fix first is the thing we should price first.\n\n2. Have a rough budget range in mind, even a wide one. It lets us design to what you will actually do rather than guess.\n\n3. If someone else has a say in the decision, try to have them there. Most questions get answered on the spot when everyone is walking the property together.\n\n{prep_line}\n\nIf you have photos of yards or ideas you like, reply with them and we will look before we arrive.\n\nSee you {day},\n{evaluator}\n{business}\n{phone}'),
    ('day_before', 3, 'Day before', 'The evening before, at 5pm',
     'Tomorrow at {time}: {evaluator} from {business}',
     E'Hi {first_name},\n\nA quick reminder: {tomorrow}\n\n{prep_line}\n\nIf the gate is locked or there is a dog, let us know so we can plan around it.\n\nIf tomorrow no longer works, reply to this email or call or text {phone} today and we will find another time. A heads up is a big help, since we plan the route the night before.\n\nSee you tomorrow,\n{evaluator}\n{business}\n{phone}'),
    ('morning_of', 4, 'Morning of', 'The morning of, at 8am',
     'See you today at {time}',
     E'Hi {first_name},\n\n{today} If anything changes on your end this morning, text {phone} and we will adjust.\n\n{evaluator}\n{business}'),
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
language sql stable
set search_path = public, extensions
as $$
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
         (j.evaluation_date at time zone o.tz) as local_naive,
         j.evaluation_date as eval_at,
         i.token as prep_token,
         coalesce(j.evaluation_mode, 'in_person') = 'digital' as digital,
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
           'how_it_works', case when m.digital
             then 'Here is how it works. You are outside Harford County, our driving area, so this one is a video walkthrough. At the time above we call you on video and you walk us round the property with your phone, showing what you want changed and what is bugging you. It usually takes 30 to 45 minutes. Have your phone charged and be at the property, and it helps a lot if the person making the decision is on the call too.'
             else 'Here is how the visit works. We walk the property with you, listen to what you want changed and what is bugging you, and take measurements and photos. It usually takes 30 to 45 minutes. It helps a lot if the person making the decision can be there.' end,
           'coming', case when m.digital
             then 'Our video walkthrough of ' || regexp_replace(coalesce(m.address, ''), ',\s*(Maryland|MD)\M.*$', '') || ' is on ' || to_char(m.local_naive, 'FMDay') || ' at ' || lower(to_char(m.local_naive, 'FMHH12:MI am')) || '. We will call you then.'
             else 'We are coming out to ' || regexp_replace(coalesce(m.address, ''), ',\s*(Maryland|MD)\M.*$', '') || ' on ' || to_char(m.local_naive, 'FMDay') || ' at ' || lower(to_char(m.local_naive, 'FMHH12:MI am')) || '.' end,
           'tomorrow', coalesce(
               (select nullif(initcap(split_part(trim(pr.full_name), ' ', 1)), '') from profiles pr where pr.id = m.assigned_to),
               m.contact_first, 'our evaluator')
             || case when m.digital
               then ' will call you on video for the walkthrough of ' || regexp_replace(coalesce(m.address, ''), ',\s*(Maryland|MD)\M.*$', '') || ' tomorrow at ' || lower(to_char(m.local_naive, 'FMHH12:MI am')) || '. Have your phone charged and be at the property.'
               else ' is coming out to ' || regexp_replace(coalesce(m.address, ''), ',\s*(Maryland|MD)\M.*$', '') || ' tomorrow at ' || lower(to_char(m.local_naive, 'FMHH12:MI am')) || '.' end,
           'today', case when m.digital
             then 'We call you on video today at ' || lower(to_char(m.local_naive, 'FMHH12:MI am')) || ' for ' || regexp_replace(coalesce(m.address, ''), ',\s*(Maryland|MD)\M.*$', '') || '. Have your phone charged and be at the property.'
             else 'See you today at ' || lower(to_char(m.local_naive, 'FMHH12:MI am')) || ' at ' || regexp_replace(coalesce(m.address, ''), ',\s*(Maryland|MD)\M.*$', '') || '.' end,
           'before_we', case when m.digital then 'Before your video walkthrough' else 'Before we come out' end,
           'prep_link', case when m.prep_token is null then ''
             else coalesce(rtrim(m.public_base_url, '/'), '') || '/prep/' || m.prep_token end,
           'prep_line', case
             when m.prep_token is null then ''
             when m.prep_submitted_at is not null then 'Thanks for filling in the form. We have read it and will come ready.'
             else E'If you have not had a chance to fill in the short form yet, it is here:\n\n'
               || coalesce(rtrim(m.public_base_url, '/'), '') || '/prep/' || m.prep_token
               || E'\n\nIt takes about five minutes. If you do not get to it, we will go through it together in the first five to ten minutes.'
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
