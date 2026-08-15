-- Group messages arrive live instead of on refresh. Realtime only broadcasts
-- tables in this publication, and it still applies RLS to each subscriber —
-- so the members-only policy on team_messages keeps holding, and someone
-- outside a group gets nothing rather than a live feed of it.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'team_messages'
  ) then
    alter publication supabase_realtime add table team_messages;
  end if;
end $$;

-- Realtime sends the full new row only when the table records it; without
-- this an INSERT arrives with just the primary key.
alter table team_messages replica identity full;

notify pgrst, 'reload schema';
