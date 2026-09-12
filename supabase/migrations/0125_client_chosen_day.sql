-- The day the client picked for themselves.
--
-- jobs.project_start_date already holds when work starts, but it is written
-- by the office too, so it cannot answer "did the client choose this". That
-- matters: a day we offered and they accepted is a promise, and a day we
-- moved them to is a conversation we still owe them.
--
-- Kept on the proposal rather than the job because it belongs to the same
-- moment as accepting and choosing how to pay, and because a job that is
-- rescheduled later should not overwrite what the client originally asked
-- for.

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'job_proposals' and column_name = 'client_chosen_day'
  ) then
    alter table job_proposals add column client_chosen_day date;
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_name = 'job_proposals' and column_name = 'client_chosen_day_at'
  ) then
    alter table job_proposals add column client_chosen_day_at timestamptz;
  end if;

  -- What we charged them, so a Stripe session that came back paid can be
  -- matched to the proposal it settled without guessing at amounts.
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'job_proposals' and column_name = 'checkout_session_id'
  ) then
    alter table job_proposals add column checkout_session_id text;
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_name = 'job_proposals' and column_name = 'paid_at'
  ) then
    alter table job_proposals add column paid_at timestamptz;
  end if;
end $$;

comment on column job_proposals.client_chosen_day is
  'The work day the client picked themselves from the days we offered.';
comment on column job_proposals.checkout_session_id is
  'Stripe Checkout session raised when they chose how to pay.';
