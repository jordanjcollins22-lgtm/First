-- What a tool is for, in one line.
--
-- The kit checklist is handed to somebody loading a van who may never have
-- held half of what is on it. A name and a photograph say which object to
-- pick up; they do not say whether it is the one for edging a bed or the one
-- for cutting root. One sentence closes that gap, and it is the difference
-- between a checklist somebody follows and one they guess at.
--
-- Short on purpose. There is a row on a printed page to fit it in, and
-- anything longer belongs behind the how-to link the tool already carries.
alter table tools add column if not exists description text;

comment on column tools.description is
  'One line on what the tool is for, for the printed kit checklist. Anything longer belongs behind how_to_url.';

notify pgrst, 'reload schema';
