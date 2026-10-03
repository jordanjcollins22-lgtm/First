-- Asking a client whether they would like to leave something for the crew.
--
-- The moment to ask is when the job is finished and the garden looks the way
-- they hoped it would, which is also the one moment nobody here is standing in
-- front of a screen. So it is a link, handed over at the door or sent after,
-- and the page it opens has one question on it.
--
-- One row per job, minted when the job is finished. It carries its own token
-- because the person opening it has no account and never will -- the token is
-- the whole of their access, and there is nothing behind it to leak: the job's
-- address, what it cost, and who worked on it are all things the client
-- already knows better than we do.
--
-- The status matters more than it looks. "asked" is a link handed over that
-- nobody has answered, "declined" is somebody who said no, and the two are
-- different facts. Counting silence as a refusal would make the tipping rate
-- move with how many links were printed rather than with how people answered
-- them, and the business would draw the wrong conclusion from it.
create table if not exists job_tips (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  job_id uuid not null references jobs(id) on delete cascade,

  -- The whole of a client's access to the page. Unguessable, and theirs.
  token text not null unique,

  status text not null default 'asked'
    check (status in ('asked', 'unpaid', 'paid', 'declined')),
  amount_cents integer check (amount_cents is null or amount_cents > 0),

  -- What the job came to when the link was minted, so the suggestions stay
  -- the same amounts if somebody re-opens the link a week later.
  job_total_cents integer,

  -- What they wrote for the crew, if anything. Often worth more than the money.
  message text,

  checkout_session_id text,
  paid_at timestamptz,
  declined_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- One ask per job. A client handed two links is a client asked twice.
  unique (job_id)
);

comment on table job_tips is
  'One ask per finished job: whether the client would like to leave something for the crew. The token is a client''s whole access to the page.';
comment on column job_tips.status is
  'asked = link handed over, nobody answered. unpaid = card form opened, no money yet. paid. declined = said no, and may still change their mind.';
comment on column job_tips.job_total_cents is
  'What the job came to when the link was minted, so the suggested amounts do not move if the link is opened again later.';

create index if not exists job_tips_org_idx on job_tips (organization_id, status);
create index if not exists job_tips_job_idx on job_tips (job_id);

alter table job_tips enable row level security;

-- Staff read and manage their own organization's asks. The client's own access
-- runs through the service role on the public page, because they have no
-- account to hold a policy against.
drop policy if exists job_tips_own_org on job_tips;
create policy job_tips_own_org on job_tips
  for all to authenticated
  using (organization_id = current_org_id())
  with check (organization_id = current_org_id());

-- Whether to ask at all.
--
-- A business that would rather not is one switch away from not, and a tip
-- prompt nobody wanted is worse than none: it reads as a toll and costs more
-- goodwill than it collects.
alter table organizations
  add column if not exists tips_enabled boolean not null default true,
  add column if not exists tips_note text;

comment on column organizations.tips_enabled is
  'Whether finished jobs get a tip link at all.';
comment on column organizations.tips_note is
  'What the tip page says about where the money goes. A client who believes a tip reaches the crew, and is wrong, writes a review about it.';

notify pgrst, 'reload schema';
