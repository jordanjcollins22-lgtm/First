-- The project review: every job scored on issues, hours, cost, a review,
-- a referral and profit.

-- An issue is only put right when it cannot happen again: what changes,
-- beside what was done.
alter table public.job_issues add column if not exists prevention text;
alter table public.job_tickets add column if not exists prevention text;

-- Did the client leave a five-star review for this job: true, false, or
-- null when nobody has said and none has been found.
alter table public.jobs add column if not exists five_star_review boolean;
alter table public.jobs add column if not exists five_star_review_at timestamptz;
alter table public.jobs add column if not exists five_star_review_by uuid references public.profiles(id) on delete set null;

-- Who sent this client to us, when it was another client.
alter table public.customers add column if not exists referred_by_customer_id uuid references public.customers(id) on delete set null;
create index if not exists customers_referred_by_idx on public.customers (referred_by_customer_id) where referred_by_customer_id is not null;
