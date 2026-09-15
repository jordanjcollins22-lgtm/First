-- The back of the door hanger.
--
-- A hanger has two sides and the paper has two sides, and up to now the table
-- only knew about one. The back has to carry the same cut in mirror image: a
-- duplex printer flips the paper, so a back drawn the same way round as the
-- front comes out cutting on the wrong side of the hole.

alter table door_hanger_slots add column if not exists face text not null default 'front'
  check (face in ('front', 'back'));

comment on column door_hanger_slots.face is
  'Which side of the paper. The back is drawn mirrored, because the printer flips it.';

-- One artwork per half per face. The old constraint allowed one per half,
-- which would have made the back overwrite the front.
alter table door_hanger_slots drop constraint if exists door_hanger_slots_organization_id_side_key;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'door_hanger_slots_org_side_face_key'
  ) then
    alter table door_hanger_slots
      add constraint door_hanger_slots_org_side_face_key unique (organization_id, side, face);
  end if;
end $$;

notify pgrst, 'reload schema';
