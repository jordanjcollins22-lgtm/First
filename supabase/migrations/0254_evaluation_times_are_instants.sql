-- Evaluation times are real instants from here on.
--
-- The public booking page, and the GoHighLevel webhook before it, wrote the
-- wall-clock time of a visit into the UTC field: "8:00" became 08:00+00,
-- which is four in the morning in Maryland, and that is what every phone
-- in the office showed. Bookings made from inside the app wrote the true
-- instant, and those rows are the ones with an end time, because the
-- in-app form is the only writer that sets one.
--
-- So: rows without an end time are wall clocks and are moved onto the
-- business's zone; rows with one are already right and are left alone.
-- The application code now writes instants from every path, so this is
-- once.

update jobs j
   set evaluation_date = (j.evaluation_date at time zone 'UTC') at time zone coalesce(o.reminder_time_zone, 'America/New_York')
  from properties p
  join customers c on c.id = p.customer_id
  join organizations o on o.id = c.organization_id
 where p.id = j.property_id
   and j.evaluation_date is not null
   and j.evaluation_end_date is null;

-- The email sequence reads the local clock off the instant now, rather
-- than the other way round.
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
         (j.evaluation_date at time zone o.tz) as local_naive,
         j.evaluation_date as eval_at,
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
