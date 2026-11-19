-- Closing out a proposal from the account manager's Do now.
--
-- Every proposal still waiting on the client shows on the account manager's
-- home with a Yes (we won it) or No (we lost it), and neither saves without
-- a reason. The outcome is the proposal's own status (accepted or declined);
-- these columns keep why, who said so, and when.
alter table public.job_proposals
  add column if not exists close_reason text,
  add column if not exists closed_by uuid references public.profiles(id) on delete set null,
  add column if not exists closed_at timestamptz;

comment on column public.job_proposals.close_reason is
  'Why the office closed this proposal as won or lost from the account manager''s Do now. Required there.';
