-- Contacting somebody who will never buy from us, on purpose.
--
-- Most of a county is not our target market — small lots, rentals, people who
-- do their own yard. The instinct is to skip them. But the person with the
-- quarter-acre knows the neighbour with the three acres, and asking them is
-- free, so "not for you" is not the end of a call, it is the middle of one.
--
-- That needed an outcome of its own. Logged as "not interested", a call that
-- produced a name looks identical to one that produced nothing, and the whole
-- point of working the rest of the county disappears from the numbers.

alter table outreach_touches drop constraint if exists outreach_touches_outcome_check;
alter table outreach_touches add constraint outreach_touches_outcome_check
  check (outcome in (
    'attempted',
    'reached',
    'interested',
    'booked',
    'referral_received',
    'not_interested',
    'do_not_contact'
  ));

-- Whether this property is one we would ever work at.
--
-- Kept separate from status, which is about our progress with them. A parcel
-- can be out of market and still be worth a call, and conflating the two is
-- how "not our market" turns into "never ring them".
alter table lead_prospects add column if not exists in_target_market boolean;

comment on column lead_prospects.in_target_market is
  'Null until somebody decides. False means we would not work here, which is a reason to ask them who they know rather than a reason to skip them.';

-- Who they pointed us at, when they gave us a name. Free text: a referral is
-- "my sister on Vale Road", not a structured record.
alter table outreach_touches add column if not exists referral_note text;

notify pgrst, 'reload schema';
