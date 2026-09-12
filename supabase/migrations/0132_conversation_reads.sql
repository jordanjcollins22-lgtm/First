-- Two things the inbox could not say.
--
-- 1. Whether anybody has dealt with a message. "Needs a reply" was worked out
--    from who spoke last, which is right until somebody rings the client back
--    instead of typing. The conversation then sits at the top of the list
--    forever, and a list that lies about what is outstanding gets ignored.
--
--    One row per job and channel, holding how far the office has read. Team
--    wide rather than per person on purpose: a client waiting on an answer is
--    waiting on the business, not on whoever happened to open the app.
--
-- 2. What a client's message is about. A message sent from a proposal used to
--    arrive as a bare sentence, so "can we skip that one?" reached somebody
--    with no idea which area they meant. The reference is snapshotted at send
--    time, because it describes what they were looking at, which is not
--    something a later edit should rewrite.

create table if not exists conversation_reads (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  channel text not null,
  organization_id uuid not null references organizations(id),
  -- Everything up to and including this moment has been dealt with.
  read_through timestamptz not null default now(),
  read_by uuid references profiles(id) on delete set null,
  read_by_name text,
  updated_at timestamptz not null default now(),
  unique (job_id, channel)
);

alter table conversation_reads enable row level security;
drop policy if exists "org_scoped_conversation_reads" on conversation_reads;
create policy "org_scoped_conversation_reads" on conversation_reads for all to authenticated
  using (organization_id = current_org_id())
  with check (organization_id = current_org_id());

-- What the client was looking at when they wrote. Null on everything the
-- office sends and on anything written outside a proposal.
alter table job_messages add column if not exists reference_label text;
alter table job_messages add column if not exists reference_kind text;

comment on column job_messages.reference_label is
  'What this message is about, snapshotted when it was sent — an area of the proposal, or the proposal itself.';

notify pgrst, 'reload schema';
