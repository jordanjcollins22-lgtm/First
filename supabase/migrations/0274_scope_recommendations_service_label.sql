-- A recommendation is written for a service as well as a note. When the
-- zone's service changes, a leaf cleanup that became snow removal, the
-- words written for the old one are stale, and this is how that is known.
alter table scope_recommendations add column if not exists service_label text;
