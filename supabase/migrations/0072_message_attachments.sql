-- Photos, video, and voice memos on internal group messages.
--
-- Attachments live in their own private bucket. The path always starts with
-- the group's id, which lets storage enforce the same members-only rule the
-- messages themselves use — a public bucket would have undone that, since a
-- URL is all anyone would need.

alter table team_messages add column if not exists attachment_path text;
alter table team_messages add column if not exists attachment_kind text;
alter table team_messages drop constraint if exists team_messages_attachment_kind_check;
alter table team_messages add constraint team_messages_attachment_kind_check
  check (attachment_kind is null or attachment_kind in ('image', 'video', 'audio'));
alter table team_messages add column if not exists attachment_name text;

-- Filled in after the fact by the transcription job, so a voice memo is
-- readable without playing it. Null means "not transcribed" — either still
-- running, or transcription isn't configured.
alter table team_messages add column if not exists transcript text;

-- A message can now carry an attachment instead of text.
alter table team_messages alter column body drop not null;

insert into storage.buckets (id, name, public)
values ('message-attachments', 'message-attachments', false)
on conflict (id) do nothing;

drop policy if exists "message_attachments_read" on storage.objects;
create policy "message_attachments_read" on storage.objects for select to authenticated
using (
  bucket_id = 'message-attachments'
  and exists (
    select 1 from team_channel_members m
    where m.channel_id::text = (storage.foldername(name))[1]
      and m.profile_id = auth.uid()
  )
);

drop policy if exists "message_attachments_write" on storage.objects;
create policy "message_attachments_write" on storage.objects for insert to authenticated
with check (
  bucket_id = 'message-attachments'
  and exists (
    select 1 from team_channel_members m
    where m.channel_id::text = (storage.foldername(name))[1]
      and m.profile_id = auth.uid()
  )
);
