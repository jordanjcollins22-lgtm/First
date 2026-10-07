-- Who each of us is in GoHighLevel.
--
-- Its calendar refuses an appointment with no team member on it. The
-- evaluator's GoHighLevel user id is looked up once by email and kept here,
-- so every booking from the app goes on the calendar under the right name.
alter table profiles add column if not exists ghl_user_id text;
