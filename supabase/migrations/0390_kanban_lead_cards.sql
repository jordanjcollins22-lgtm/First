-- The Sales board's Backlog is the leads that need reaching out to: every
-- prospect still marked new or queued, and not asked to be left alone. Each
-- gets one card, made when the Sales board is opened. A new lead joins at the
-- bottom; the top card is the priority. Backlogs can also be split into
-- groups (see the end of this file).

alter table kanban_cards add column if not exists prospect_id uuid references lead_prospects(id) on delete cascade;

-- One card per lead. Not partial, so the app's upsert can name it.
create unique index if not exists kanban_cards_prospect_idx on kanban_cards (prospect_id);

alter table kanban_cards drop constraint if exists kanban_cards_source_check;
alter table kanban_cards add constraint kanban_cards_source_check
  check (source in ('manual', 'ghl', 'job', 'lead'));

-- Groups inside a Backlog, e.g. Sales: Leads and Converting. The board's
-- groups in order; null means the app's default for that department, an
-- empty list means no groups. A card's group is its name; a card whose group
-- is gone shows under Other.
alter table kanban_boards add column if not exists backlog_groups text[];
alter table kanban_cards add column if not exists backlog_group text;
