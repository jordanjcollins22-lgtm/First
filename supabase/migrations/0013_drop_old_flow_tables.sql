-- Removes the old Turf.js/map-editor schema entirely. The last app code
-- referencing it (the JobWorkspace editor, the crew preview page, and the
-- Service Templates admin page) has already been retired -- these tables
-- have had nothing reading or writing them since. Service Templates'
-- pricing concept has been folded into the `services` table, which the
-- Service Pricing page already manages.
--
-- Drop order respects foreign keys: children before parents.

drop table if exists work_area_geometry_versions;
drop table if exists photos;
drop table if exists work_areas;
drop table if exists zones;
drop table if exists service_templates;
