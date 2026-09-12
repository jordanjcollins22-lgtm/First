-- A day off can now optionally carry a time range (e.g. off 2-4pm for an
-- appointment) instead of only ever meaning the whole day. Both columns
-- null = the whole day; both set = that window only.

alter table availability_days_off add column if not exists start_time time;
alter table availability_days_off add column if not exists end_time time;

alter table availability_days_off drop constraint if exists availability_days_off_time_range_check;
alter table availability_days_off add constraint availability_days_off_time_range_check
  check (
    (start_time is null and end_time is null)
    or (start_time is not null and end_time is not null and start_time < end_time)
  );
