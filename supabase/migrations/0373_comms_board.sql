-- Communications Board (/conversations/board).
--
-- Every inbound message, from any channel, is one card per person. The
-- messages themselves stay where they already live (job_messages,
-- meta_messages, google_reviews, voice_calls, jobs.client_notes); this adds
-- only what the board has to remember:
--
-- 1. comms_board_cards: each person's card. Its lane, Claude's breakdown
--    (intent, resources, recommended action, a question for the owner), the
--    draft and which of their messages it was written from, every No with its
--    why, and what was sent.
-- 2. comms_manual_messages: messages from channels with no feed (a letter,
--    Nextdoor, TikTok, a comment), added by hand on the board.
--
-- Without this migration the board still shows every card, with lanes worked
-- out from the messages, and says saving needs update 0373.

create table if not exists public.comms_board_cards (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- The person: "c:<customer id>", "p:<last 10 digits>", "e:<email>" or "h:<handle>".
  person_key text not null,
  customer_id uuid references public.customers(id) on delete set null,
  lane text not null default 'backlog'
    check (lane in ('backlog', 'breakdown', 'doing', 'track', 'validate', 'done')),
  -- Breakdown.
  intent text,
  intent_summary text,
  -- [{ label, href, highlight, lines }]
  resources jsonb not null default '[]'::jsonb check (jsonb_typeof(resources) = 'array'),
  -- { kind: send | no_reply | proposal_price | proposal_remove | book, label, ... }
  action jsonb,
  -- { text, options[] }: the owner has to answer before anything is recommended.
  question jsonb,
  answer text,
  -- Answer.
  draft text,
  draft_channel text,
  draft_by_hand boolean not null default false,
  -- The newest of their messages the breakdown and draft read. A newer one cancels both.
  based_on timestamptz,
  cancelled_at timestamptz,
  -- Validate. [{ why, at }]: every No, so the redraft reads all of them.
  no_reasons jsonb not null default '[]'::jsonb check (jsonb_typeof(no_reasons) = 'array'),
  sent_body text,
  sent_channel text,
  sent_at timestamptz,
  sent_by_hand boolean not null default false,
  sent_did text,
  sent_by uuid references public.profiles(id) on delete set null,
  follow_up_on date,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, person_key)
);
create index if not exists comms_board_cards_lane_idx on public.comms_board_cards (organization_id, lane, updated_at);
alter table public.comms_board_cards enable row level security;
drop policy if exists comms_board_cards_own_org on public.comms_board_cards;
create policy comms_board_cards_own_org on public.comms_board_cards
  for all to authenticated
  using (organization_id = (select current_org_id()))
  with check (organization_id = (select current_org_id()));

create table if not exists public.comms_manual_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  -- A new contact with no customer row: what we know about them.
  contact_name text,
  contact_phone text,
  contact_email text,
  contact_handle text,
  channel text not null check (channel in (
    'sms', 'call', 'voicemail', 'email', 'form', 'fb_dm', 'ig_dm', 'fb_comment', 'ig_comment',
    'fb_mention', 'ig_mention', 'google', 'mail', 'nextdoor', 'tiktok', 'other'
  )),
  direction text not null default 'in' check (direction in ('in', 'out')),
  body text not null check (length(body) between 1 and 5000),
  received_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists comms_manual_messages_org_idx on public.comms_manual_messages (organization_id, received_at desc);
alter table public.comms_manual_messages enable row level security;
drop policy if exists comms_manual_messages_own_org on public.comms_manual_messages;
create policy comms_manual_messages_own_org on public.comms_manual_messages
  for all to authenticated
  using (organization_id = (select current_org_id()))
  with check (organization_id = (select current_org_id()));
