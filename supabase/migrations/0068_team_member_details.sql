-- Real details on a team member's account rather than just an email: their
-- name split into first/last, a phone number, and — for anyone who drives
-- for the business — their licence.
--
-- full_name stays the display field the rest of the app reads, kept in sync
-- from first/last so nothing has to change everywhere at once.

alter table profiles add column if not exists first_name text;
alter table profiles add column if not exists last_name text;

-- Backfill from whatever full_name already holds: everything before the
-- first space is the first name, the rest is the last name.
update profiles
set
  first_name = nullif(split_part(trim(full_name), ' ', 1), ''),
  last_name = nullif(trim(substr(trim(full_name), strpos(trim(full_name), ' ') + 1)), '')
where full_name is not null
  and trim(full_name) <> ''
  and first_name is null
  and last_name is null;

-- A single-word full_name leaves the whole thing duplicated into last_name
-- by the expression above; clear that.
update profiles set last_name = null where last_name = first_name;

-- Driving / licence details, only meaningful when they drive for us.
alter table profiles add column if not exists drives_for_company boolean not null default false;
alter table profiles add column if not exists license_number text;
alter table profiles add column if not exists license_state text;
alter table profiles add column if not exists license_class text;
alter table profiles add column if not exists license_expires date;

notify pgrst, 'reload schema';
