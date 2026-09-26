-- How much warning an evaluation needs.
--
-- The booking page offered any free hour from about now, so a visit could
-- land on a day already planned around something else. Two rules, both the
-- business's: a minimum number of hours between booking and visit, and
-- whether the same day is ever offered at all. Same day is off by default,
-- because a day that fills up from the booking page is a day nobody planned.
alter table organizations
  add column if not exists booking_notice_hours integer not null default 0
    check (booking_notice_hours >= 0 and booking_notice_hours <= 720),
  add column if not exists booking_same_day boolean not null default false;

comment on column organizations.booking_notice_hours is
  'Fewest hours between somebody booking and the visit. 0 means only the same-day rule applies.';
comment on column organizations.booking_same_day is
  'Whether the booking page may offer a visit later today. Off means the earliest visit is tomorrow, in the business time zone.';

notify pgrst, 'reload schema';
