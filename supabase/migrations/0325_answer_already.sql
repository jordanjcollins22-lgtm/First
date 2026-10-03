-- A post somebody had already commented on, on Facebook itself, before the
-- board knew of it: "already". Counts as answered by them, so it leaves
-- their board and nobody else is told there is room, but it is not a
-- comment made from the board, so it is not counted as one today or on the
-- leaderboard.
alter table public.outreach_post_answers drop constraint if exists outreach_post_answers_status_check;
alter table public.outreach_post_answers
  add constraint outreach_post_answers_status_check check (status in ('written', 'posted', 'let_go', 'already'));
