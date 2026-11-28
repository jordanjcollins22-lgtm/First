-- Which crew works a visit, and whether the office set the crew's order by hand.
-- Applied to production 2026-11-28.
alter table public.job_work_sessions add column if not exists crew_lead_id uuid references public.profiles(id) on delete set null;
alter table public.job_work_sessions add column if not exists route_locked boolean not null default false;
comment on column public.job_work_sessions.crew_lead_id is 'Whose crew (truck lead) works this visit. Null = the job''s lead. Two visits on one job and day = two crews there.';
comment on column public.job_work_sessions.route_locked is 'True when the office set this crew''s order by hand: the day follows stop_order exactly instead of nearest-next.';
