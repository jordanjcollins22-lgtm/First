-- What it can actually pull.
--
-- The plan assumed a new truck would tow more than the old one. It does not:
-- the Titan pulls 11,000 lb and the Cybertruck All-Wheel Drive pulls the same,
-- so the recommendation was buying parity, not an upgrade -- and the cheaper
-- rear-wheel-drive at 7,500 lb would have been a downgrade nobody would have
-- noticed until a loaded trailer was on the back.
--
-- That is not something to keep in a note field. A replacement that cannot do
-- the job of the thing it replaces is the one mistake in this whole plan that
-- cannot be undone cheaply, so it goes in a column and gets checked.
alter table fleet_assets add column if not exists tow_rating_lb integer
  check (tow_rating_lb is null or tow_rating_lb >= 0);
alter table fleet_targets add column if not exists tow_rating_lb integer
  check (tow_rating_lb is null or tow_rating_lb >= 0);

comment on column fleet_assets.tow_rating_lb is
  'What it is rated to tow, in pounds. Null on trailers and on anything nobody has looked up.';
comment on column fleet_targets.tow_rating_lb is
  'What the replacement is rated to tow. Compared against what it replaces, because buying less capability by accident is expensive to undo.';

notify pgrst, 'reload schema';
