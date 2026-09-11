-- Everything a person can say about a charge that the transactions cannot.
--
-- Two gaps showed up the first time somebody went through the overhead line by
-- line, and both of them were money.
--
-- The first is a charge that is real, monthly and not regular enough to be
-- detected. A vehicle lease billed twice at different amounts in six months is
-- not a rhythm any detector should trust, and it is still a lease. There was
-- no way to say "count this anyway", so it was simply absent.
--
-- The second is which amount a charge is worth. The median is right for a bill
-- that wobbles around a level and wrong for one that stepped up: the rent ran
-- at 2,298 and went to 2,791, and the median of those is a number the business
-- has never paid. Whether a run of higher months is a step or a bad patch
-- cannot be read off the numbers -- it is a judgement made while looking at
-- the history, which is what this column holds.
alter table recurring_decisions
  add column if not exists included_at timestamptz,
  add column if not exists amount_basis text
    check (amount_basis is null or amount_basis in ('median', 'latest'));

comment on column recurring_decisions.included_at is
  'Counts in the overhead even though no rhythm was detected. For a real monthly cost billed too irregularly to find.';
comment on column recurring_decisions.amount_basis is
  'Which amount to price from: the median of every charge, or the most recent one. Null means the median.';

-- What a day of work has to earn before the business has made anything.
--
-- Quotes carry a flat percentage for overhead, which is the same percentage
-- whether a job takes an afternoon or a fortnight. That is backwards: overhead
-- is a cost of time passing, not of work done, and a two-week job ties up two
-- weeks of rent whatever its materials cost.
--
-- Turning the monthly figure into a daily one takes three numbers, and all
-- three are somebody's judgement rather than anything the bank knows. How many
-- days a month the crew is actually on a paying job, how long a day is, and
-- how many people go out. They are stored so they can be argued with, because
-- a per diem is only as honest as the days you admit to losing.
alter table organizations
  add column if not exists billable_days_per_month integer not null default 18,
  add column if not exists crew_hours_per_day numeric not null default 8,
  add column if not exists crew_size integer not null default 2,
  add column if not exists overhead_basis text not null default 'per_diem'
    check (overhead_basis in ('percent', 'per_diem'));

comment on column organizations.billable_days_per_month is
  'Days a month the crew is on a paying job. Not working days: rain, quoting, breakdowns and loading are real and are not on an invoice.';
comment on column organizations.crew_hours_per_day is
  'Hours on site in one of those days.';
comment on column organizations.crew_size is
  'How many people go out. Overhead does not scale with the crew; this only converts between crew-hours and days.';
comment on column organizations.overhead_basis is
  'How a quote charges overhead: the old flat percentage, or a per diem worked out from what the bank says the business costs to keep open.';

notify pgrst, 'reload schema';
