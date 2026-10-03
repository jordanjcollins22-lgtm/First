-- Labor cost was only ever counting one person: minutes-per-sq-ft x the
-- blended hourly rate. A job worked by 3 people costs 3x that. crew_size
-- captures how many people work the service at once, so labor cost becomes
-- crew-hours (minutes x crew_size), not clock-minutes.
alter table services add column if not exists crew_size integer not null default 1;
alter table services drop constraint if exists services_crew_size_check;
alter table services add constraint services_crew_size_check check (crew_size >= 1);
