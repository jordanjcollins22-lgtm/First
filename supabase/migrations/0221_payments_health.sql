-- Whether we can still take money.
--
-- Stripe going away is silent. The key gets rolled, or the account gets
-- restricted, and nothing in the app changes: proposals still go out, clients
-- still accept, and the first anybody hears is a client mentioning that the
-- payment page would not load — if they mention it at all. One client went
-- five days with an unpaid job because a Stripe failure was caught and
-- thrown away.
--
-- One row per organisation, holding what we last believed. Stored rather than
-- derived because the point is the change: the office is told when card
-- payments stop and told again when they come back, and neither of those is
-- knowable from a single reading.
--
-- changed_at is when it last flipped, not when it was last looked at. Those
-- are different questions and the second one is the boring one.
create table if not exists payments_health (
  organization_id uuid primary key references organizations(id) on delete cascade,
  state text not null default 'ok' check (state in ('ok', 'down')),
  -- What went wrong, in words somebody can act on.
  detail text,
  checked_at timestamptz not null default now(),
  changed_at timestamptz not null default now(),
  -- So an outage nobody has fixed is mentioned once a day rather than every
  -- time anything touches Stripe.
  last_alert_at timestamptz
);

comment on table payments_health is
  'Whether Stripe is answering, one row per organisation. Stored rather than derived because the alert is on the change: told when card payments stop, told again when they come back.';

alter table payments_health enable row level security;

drop policy if exists payments_health_own_org on payments_health;
create policy payments_health_own_org on payments_health
  for all using (organization_id = current_org_id())
  with check (organization_id = current_org_id());

notify pgrst, 'reload schema';
