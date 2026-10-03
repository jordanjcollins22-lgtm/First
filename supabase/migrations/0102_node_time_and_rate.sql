-- How long a thing takes, and what an hour of it costs.
--
-- Time could already be counted, but only by linking to something in
-- inventory priced per hour. Most work is not like that: a door hanger drop
-- takes four hours because somebody walks it, and there is no row to link to.
-- Without a duration the calendar cannot block the right amount of the day,
-- which is the whole reason for putting a date on it.

alter table knowledge_nodes add column if not exists duration_hours numeric
  check (duration_hours is null or duration_hours > 0);

alter table knowledge_nodes add column if not exists hourly_rate numeric
  check (hourly_rate is null or hourly_rate >= 0);

comment on column knowledge_nodes.duration_hours is
  'How long one run of this takes, in hours. What the calendar blocks out.';
comment on column knowledge_nodes.hourly_rate is
  'What an hour of it costs. Multiplied by duration_hours into the labour total, alongside anything linked to inventory by the hour.';

notify pgrst, 'reload schema';
