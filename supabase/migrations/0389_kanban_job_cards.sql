-- The Operations board's Backlog is the list of jobs that still need doing.
-- Each open job (approved or in progress, not declined) gets one card, made
-- when the Operations board is opened. A new job joins at the bottom; the
-- order after that is whatever the team sets, because the top card is the
-- priority.

alter table kanban_cards add column if not exists job_id uuid references jobs(id) on delete cascade;

-- One card per job, however often the board is opened. Not a partial index:
-- the app's upsert names job_id as its conflict target, and cards with no job
-- (null) never collide with each other.
create unique index if not exists kanban_cards_job_idx on kanban_cards (job_id);

alter table kanban_cards drop constraint if exists kanban_cards_source_check;
alter table kanban_cards add constraint kanban_cards_source_check check (source in ('manual', 'ghl', 'job'));
