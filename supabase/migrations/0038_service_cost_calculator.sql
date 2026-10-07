-- Lets COGS be calculated instead of guessed: materials already linked to a
-- service (Inventory > Materials > Auto-apply rules) contribute their
-- cost per sq ft automatically; minutes_per_sqft x the business's blended
-- crew_cost_per_hour gives labor cost per sq ft. The two together are the
-- calculated COGS/sq ft, which still just writes into the existing
-- cogs/cost columns — nothing new to learn on the pricing side.
alter table organizations add column if not exists crew_cost_per_hour numeric;
alter table services add column if not exists minutes_per_sqft numeric;
