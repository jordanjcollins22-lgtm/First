-- Which copy of the extension last checked in, and when. Written each time
-- it asks the app what to do, which it does even while the finder is paused,
-- so the app can say "update the extension" without waiting for a look.
alter table outreach_agent_settings
  add column if not exists extension_version text,
  add column if not exists extension_seen_at timestamptz;
