-- One screenshot, one comment.
--
-- The same post uploaded twice made two links and two comments under the
-- same neighbour's question, which is the one thing a group notices. The
-- picture's own fingerprint is kept with the record, so the second upload
-- is refused and points at the first.

alter table outreach_links add column if not exists screenshot_hash text;

create index if not exists outreach_links_shot_hash_idx
  on outreach_links(organization_id, screenshot_hash)
  where screenshot_hash is not null;
