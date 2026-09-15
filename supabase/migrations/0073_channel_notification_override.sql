-- Per-conversation notification choice, on top of the general one.
--
-- Lives on the membership row rather than in its own table — "how do I want
-- to be notified about this group" only means anything while you're in it,
-- and it disappears with the membership.
--
-- null  = follow the general "Team group messages" setting
-- true  = always tell me about this one, even if the general setting is off
-- false = mute this one, even if the general setting is on

alter table team_channel_members add column if not exists notify_override boolean;
