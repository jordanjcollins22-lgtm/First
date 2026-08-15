-- Per-member notification override for a team channel.
-- Nullable tri-state: null = inherit the member's global notification
-- preference, true = always notify, false = never notify.
alter table team_channel_members add column if not exists notify_override boolean;
