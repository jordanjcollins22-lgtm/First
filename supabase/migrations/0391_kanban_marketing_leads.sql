-- The Marketing board, from Jordan's mockup, and a Client and a Team
-- pipeline on every board, each with its own questions and goals.
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

-- Every board runs two pipelines through the same columns: Client (leads,
-- jobs, clients) and Team (hiring and the people on the team). Each has its
-- own WIP count. Cards made from jobs, leads and new clients are Client.
alter table kanban_cards add column if not exists pipeline text not null default 'client';
alter table kanban_cards drop constraint if exists kanban_cards_pipeline_check;
alter table kanban_cards add constraint kanban_cards_pipeline_check
  check (pipeline in ('client', 'team'));

-- Client and Team ask different questions and have different goals. The
-- answer_question, validate_question and goals columns above are Client's;
-- these are Team's. For Marketing, a Team lead is someone who might join the
-- team: "Did they book an interview?", then "Did they join the team?".
alter table kanban_boards add column if not exists team_answer_question text;
alter table kanban_boards add column if not exists team_validate_question text;
alter table kanban_boards add column if not exists team_goals text[];

-- Marketing's Team Backlog is the recent job applicants still in the running,
-- one card each.
alter table kanban_cards add column if not exists applicant_id uuid references job_applicants(id) on delete cascade;
create unique index if not exists kanban_cards_applicant_idx on kanban_cards (applicant_id);

alter table kanban_cards drop constraint if exists kanban_cards_source_check;
alter table kanban_cards add constraint kanban_cards_source_check
  check (source in ('manual', 'ghl', 'job', 'lead', 'customer', 'applicant'));
