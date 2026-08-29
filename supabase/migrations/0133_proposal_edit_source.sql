-- Where a change to a proposal came from.
--
-- Most of them arrive as a text message. The client reads the proposal on
-- their phone, does not use the buttons on it, and texts "can we leave the
-- back bed for now" instead. Somebody in the office then makes the change,
-- and the record said only that the office made it — which reads, months
-- later, like we quietly took work off a quote nobody asked us to change.
--
-- So a trim records who asked for it and how they asked, alongside the note
-- of what they actually said.

alter table proposal_edits add column if not exists requested_via text;

comment on column proposal_edits.requested_via is
  'How the client asked for this change: text, call, in_person, or office when it was our own decision.';

notify pgrst, 'reload schema';
