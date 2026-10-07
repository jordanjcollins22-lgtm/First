-- Following up an Indeed applicant who was sent our application link.
--
-- applicant_id: the application they went on to fill in, so the Hiring page
-- can tell who has and who hasn't. Set when they apply through the link
-- (it carries the invite) or, for links sent before that, by name and job.
-- reminded_at: the one reminder sent through Indeed when they hadn't applied
-- a day later. Never more than one.
alter table public.indeed_invites add column if not exists applicant_id uuid references public.job_applicants(id) on delete set null;
alter table public.indeed_invites add column if not exists reminded_at timestamptz;
