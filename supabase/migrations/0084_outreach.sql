-- Lead generation, as something a person can be handed rather than something
-- one person knows how to do.
--
-- The problem this solves is not "we need more marketing ideas". It is that
-- the ways this business already wins work live in one person's head, so when
-- that person is away nobody books an evaluation and the calendar goes quiet
-- three weeks later. Written down, targeted, and logged, the same activity
-- survives a holiday.
--
-- Two axes rather than one, because they answer different questions.
-- Temperature is how warm the contact is, which decides what you say.
-- Cost is whether doing it spends money, which decides what somebody with no
-- budget can still get on with today.

create table if not exists outreach_channels (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),

  -- Stable slug, so a rename doesn't orphan the history.
  key text not null,
  name text not null,

  temperature text not null default 'cold'
    check (temperature in ('cold', 'warm', 'inbound')),
  cost_type text not null default 'free'
    check (cost_type in ('free', 'paid')),

  -- One line: what this channel actually is.
  summary text,
  -- The how-to. Plain text, one step per line — this is the half that lets
  -- somebody else run it, so it is a first-class column and not a note.
  playbook text,

  -- How many of these to do in a day. Null means "no daily rhythm" — a paid
  -- ad campaign is set up once, not chipped at every morning.
  daily_target integer,

  active boolean not null default true,
  sort_order integer not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (organization_id, key)
);

create index if not exists outreach_channels_org_idx
  on outreach_channels(organization_id, active, sort_order);

drop trigger if exists set_updated_at on outreach_channels;
create trigger set_updated_at before update on outreach_channels
  for each row execute function set_updated_at();

-- One recorded attempt to reach somebody.
--
-- Deliberately one row per attempt rather than a counter on the channel: the
-- counter answers "did we do the work", and only the rows answer "did it work",
-- which is the question that decides where the next hour goes.
create table if not exists outreach_touches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  channel_id uuid not null references outreach_channels(id) on delete cascade,

  -- Who did it. The point is that this is somebody's job today.
  profile_id uuid references profiles(id) on delete set null,

  -- Who it was aimed at. Either, or neither for a channel that is broadcast
  -- rather than one-to-one — a batch of door hangers has no single recipient.
  prospect_id uuid references lead_prospects(id) on delete set null,
  customer_id uuid references customers(id) on delete set null,

  outcome text not null default 'attempted'
    check (outcome in (
      'attempted',
      'reached',
      'interested',
      'booked',
      'not_interested',
      'do_not_contact'
    )),
  note text,

  at timestamptz not null default now(),
  -- The working day this counts towards, in local terms, so an evening call
  -- still lands on the day the person was working.
  day date not null default (now() at time zone 'utc')::date,

  created_at timestamptz not null default now()
);

create index if not exists outreach_touches_channel_day_idx
  on outreach_touches(organization_id, channel_id, day);
create index if not exists outreach_touches_person_day_idx
  on outreach_touches(organization_id, profile_id, day);
create index if not exists outreach_touches_prospect_idx
  on outreach_touches(prospect_id);

alter table outreach_channels enable row level security;
alter table outreach_touches enable row level security;

-- The whole point is that anybody on the team can pick this up, so the
-- playbooks and the day's tally are readable and writable org-wide. There is
-- nothing sensitive in "we called thirty people today"; hiding it is how it
-- goes back to being one person's job.
drop policy if exists "org_scoped_outreach_channels" on outreach_channels;
create policy "org_scoped_outreach_channels" on outreach_channels for all to authenticated
  using (organization_id = current_org_id())
  with check (organization_id = current_org_id());

drop policy if exists "org_scoped_outreach_touches" on outreach_touches;
create policy "org_scoped_outreach_touches" on outreach_touches for all to authenticated
  using (organization_id = current_org_id())
  with check (organization_id = current_org_id());

-- Seed the ways this business already knows how to win work.
--
-- Written as instructions to a person who has never done it, because that is
-- exactly who will be reading them. Every one of them is editable afterwards —
-- these are a starting point, not the company's opinion set in stone.
insert into outreach_channels
  (organization_id, key, name, temperature, cost_type, summary, playbook, daily_target, sort_order)
select
  o.id, v.key, v.name, v.temperature, v.cost_type, v.summary, v.playbook, v.daily_target, v.sort_order
from organizations o
cross join (values
  (
    'cold_call', 'Cold calling', 'cold', 'free',
    'Ring homeowners in the areas we already do well in.',
    E'1. Open Leads and work the prospect list top-down — it is already sorted by likely job size.\n'
    '2. Call between 9am and 11am, or 4pm and 6pm. Middle of the day is dead.\n'
    '3. Opening: "Hi, this is [name] from JS Landscaping — we are doing work over on [nearby street] this week and I am ringing a few neighbours. Is your yard something you have been meaning to get to?"\n'
    '4. If they say yes, do not price anything. Book the evaluation: "The way we do it is I come out, walk it with you, and put together exactly what it would take. Takes about half an hour and costs nothing. Are mornings or afternoons better?"\n'
    '5. Log every call here, even the no-answers. Thirty calls that nobody logged is a day nobody can learn from.\n'
    '6. If they ask not to be called again, log it as do-not-contact. That is the one outcome that must never be skipped.',
    30, 10
  ),
  (
    'cold_dm', 'Cold DM', 'cold', 'free',
    'Message homeowners on Facebook, Instagram and Nextdoor.',
    E'1. Search local groups for anyone posting about their yard, a new house, drainage, or a contractor who let them down.\n'
    '2. Comment publicly first where it is a public post — helpful, no pitch. Then message.\n'
    '3. Keep the message under three lines and end on a question. Anything longer reads as a template.\n'
    '4. Lead with the specific thing they mentioned, never with our services.\n'
    '5. Aim for a booked evaluation, not a price. Nobody buys landscaping from a DM thread.\n'
    '6. Log each one. If they reply and say no, log not-interested — it stops somebody messaging them again in a month.',
    15, 20
  ),
  (
    'cold_sms', 'Cold SMS', 'cold', 'paid',
    'Text prospects from the bought or built list.',
    E'1. Only text numbers on the prospect list that have not been marked do-not-contact.\n'
    '2. Identify the business in the first line and give a way out in the last: "Reply STOP and we will not text again."\n'
    '3. One message. No follow-up text unless they reply — a second unanswered text is what gets a number blocked.\n'
    '4. Best window is late morning. Never before 8am or after 8pm.\n'
    '5. Log every send and every reply here. A STOP reply is logged as do-not-contact immediately.\n'
    '6. Texting people who never asked to hear from us carries real legal exposure. If you are unsure about a list, ask before sending.',
    40, 30
  ),
  (
    'past_client', 'Past client follow-up', 'warm', 'free',
    'Ring people we have already done work for.',
    E'1. Open Contacts and sort by the last job date. Anyone past a year is worth a call.\n'
    '2. Reference the actual work: "We put the beds in round the front for you last spring — how have they held up?"\n'
    '3. Ask the question that books work: "Is there anything on the list for this year?"\n'
    '4. These convert several times better than any cold channel and cost nothing. When a day is quiet, this is the first thing to do, not the last.\n'
    '5. Log the call against the client so nobody rings them twice in a fortnight.',
    10, 40
  ),
  (
    'referral_ask', 'Referral ask', 'warm', 'free',
    'Ask happy clients for the neighbour who needs us.',
    E'1. Ask within a week of finishing, while the yard still looks new and they are still pleased.\n'
    '2. Be specific — "Do you know anyone?" gets nothing. "Is there a neighbour whose yard you have looked at and thought someone should sort that out?" gets a name.\n'
    '3. Ask whether we may use their name when we call. It changes the next call from cold to warm.\n'
    '4. Log the ask whether or not you got a name, so we learn which jobs produce referrals.',
    5, 50
  ),
  (
    'door_hangers', 'Door hangers and yard signs', 'cold', 'paid',
    'Physical placements around jobs we are already doing.',
    E'1. Every job we are on is the centre of the next one. Hang the street either side while the crew is on site.\n'
    '2. Plan and record where they went on the Attractors page so we can tell which streets produced work.\n'
    '3. Log one touch here per run, with the street in the note, rather than one per door.\n'
    '4. The sign in the yard of a finished job is worth more than the whole street of hangers. Ask the client before you leave.',
    null, 60
  ),
  (
    'paid_ads', 'Paid ads', 'cold', 'paid',
    'Facebook and Google, pointed at booking an evaluation.',
    E'1. Send the ad to a booking link, never to the home page. A visitor who has to hunt for how to contact us does not contact us.\n'
    '2. Run one thing at a time and give it two weeks before judging it.\n'
    '3. Check the Leads page for which channel produced the work — the ad platform will always tell you it is winning.\n'
    '4. Set up once, then log a touch when you change the budget or the creative, with what you changed in the note.',
    null, 70
  ),
  (
    'google_reviews', 'Google profile and reviews', 'inbound', 'free',
    'The free channel that keeps working while nobody is doing anything.',
    E'1. Ask every finished client for a review, on the day, from their driveway. Ask later and it does not happen.\n'
    '2. Post photos of finished work to the Google profile weekly — it is the single cheapest thing that moves local ranking.\n'
    '3. Reply to every review, including the bad ones, in a way a stranger reading it would find reasonable.\n'
    '4. Log a touch when you post or when you ask for a review.',
    3, 80
  )
) as v(key, name, temperature, cost_type, summary, playbook, daily_target, sort_order)
on conflict (organization_id, key) do nothing;
