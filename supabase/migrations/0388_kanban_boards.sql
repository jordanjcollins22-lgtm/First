-- Department Kanban boards: a board on each of Marketing, Sales, Operations
-- and Admin, drawn from the whiteboard.
--
--   Backlog -> Breakdown [doing | done] -> Answer [doing | track | done]
--           -> Validate [doing | done]
--
-- A card is a question or a task. Track holds answers waiting on somebody
-- outside the business. The top card in a column is the priority.
--
-- kanban_boards: a department's WIP limits. A row is written the first time
--                somebody saves limits; until then the app's defaults apply.
-- kanban_cards:  the cards. `stage` is the column and sub-column, and
--                `position` orders it top to bottom.

create table if not exists kanban_boards (
  organization_id uuid not null references organizations(id) on delete cascade,
  department text not null check (department in ('marketing', 'sales', 'operations', 'admin')),
  -- Most cards a column holds at once, counting its Done (and Track) cards.
  -- Backlog and Validate > Done have no limit.
  wip_breakdown integer not null default 2 check (wip_breakdown between 1 and 50),
  wip_answer integer not null default 4 check (wip_answer between 1 and 50),
  wip_validate integer not null default 2 check (wip_validate between 1 and 50),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, department)
);

create table if not exists kanban_cards (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  department text not null check (department in ('marketing', 'sales', 'operations', 'admin')),
  stage text not null default 'backlog'
    check (stage in (
      'backlog',
      'breakdown', 'breakdown_done',
      'answer', 'answer_track', 'answer_done',
      'validate', 'validate_done'
    )),
  -- Lower is higher on the board. New cards go to the bottom.
  position double precision not null default 0,
  title text not null,
  details text,
  -- Who asked: a client or somebody on the crew. Validate is checking back with them.
  asked_by text,
  source text not null default 'manual' check (source in ('manual', 'ghl')),
  ghl_contact_id text,
  ghl_message_id text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists kanban_cards_board_idx on kanban_cards (organization_id, department, stage, position);
-- A GHL message makes one card at most, however often the webhook retries.
create unique index if not exists kanban_cards_ghl_message_idx
  on kanban_cards (organization_id, ghl_message_id) where ghl_message_id is not null;

drop trigger if exists set_updated_at on kanban_boards;
create trigger set_updated_at before update on kanban_boards
  for each row execute function set_updated_at();
drop trigger if exists set_updated_at on kanban_cards;
create trigger set_updated_at before update on kanban_cards
  for each row execute function set_updated_at();

alter table kanban_boards enable row level security;
alter table kanban_cards enable row level security;

drop policy if exists kanban_boards_own_org on kanban_boards;
create policy kanban_boards_own_org on kanban_boards
  for all using (organization_id = current_org_id())
  with check (organization_id = current_org_id());

drop policy if exists kanban_cards_own_org on kanban_cards;
create policy kanban_cards_own_org on kanban_cards
  for all using (organization_id = current_org_id())
  with check (organization_id = current_org_id());

comment on table kanban_cards is
  'Cards on the department Kanban boards (Marketing, Sales, Operations, Admin): a question or task moving Backlog, Breakdown, Answer, Validate.';
