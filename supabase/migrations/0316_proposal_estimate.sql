-- The estimate behind a proposal: each area's hours and crew, the days, the
-- drive to and from the shop and to the supplier, the materials and what it
-- all costs. Kept with the proposal when it is built from the site map, so
-- the number somebody says yes or no to sits beside the workings that made
-- it, and opening a job does not ask the map service for the drive again.
alter table job_proposals add column if not exists estimate jsonb;
