-- A visit the crew goes straight to, with their own tools.
--
-- A trial day for somebody new, or a job that wants nothing from the shop:
-- no kit to load, no shop stop, the day starts on the way to the site. The
-- day flow skips the shop for such a visit rather than making somebody who
-- has never seen the shop tap "I'm at the shop".
alter table job_work_sessions add column if not exists meet_on_site boolean not null default false;
comment on column job_work_sessions.meet_on_site is 'The crew goes straight to the site with their own tools. No shop stop, no loadout.';
