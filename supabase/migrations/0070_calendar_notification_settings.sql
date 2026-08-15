-- Notification settings belong to the calendar, not the business — an
-- Installs calendar wants a different reminder lead time than Evaluations,
-- and you may want one calendar to nag and another to stay quiet.
--
-- These decide what a calendar SENDS. Whether a given person RECEIVES it is
-- still their own choice on the Notifications page; both have to say yes.

alter table calendars add column if not exists reminders_enabled boolean not null default true;
alter table calendars add column if not exists reminder_hours_before integer not null default 24;
alter table calendars add column if not exists notify_on_booking boolean not null default true;
alter table calendars add column if not exists notify_on_change boolean not null default true;

notify pgrst, 'reload schema';
