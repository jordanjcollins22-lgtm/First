-- The Marketing board, from Jordan's mockup.
--
-- Each board asks its own question of the Answer and Validate columns (for
-- Marketing: "Did they book?" and "Did we close them?") and names the
-- department's goals along the bottom. Null means the app's default for that
-- department.
alter table kanban_boards add column if not exists answer_question text;
alter table kanban_boards add column if not exists validate_question text;
alter table kanban_boards add column if not exists goals text[];

-- The Marketing Backlog is the new leads: each client who came in recently
-- (booked online, an ad, a tracked link, a call) gets one card, made when the
-- Marketing board is opened. The card shows whether they booked an evaluation
-- and a job, read from the app.
alter table kanban_cards add column if not exists customer_id uuid references customers(id) on delete cascade;

-- One card per lead. Not partial, so the app's upsert can name it.
create unique index if not exists kanban_cards_customer_idx on kanban_cards (customer_id);

alter table kanban_cards drop constraint if exists kanban_cards_source_check;
alter table kanban_cards add constraint kanban_cards_source_check
  check (source in ('manual', 'ghl', 'job', 'lead', 'customer'));
