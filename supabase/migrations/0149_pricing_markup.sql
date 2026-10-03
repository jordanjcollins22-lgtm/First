-- How a job's direct cost becomes the price a client is quoted.
--
-- The business quotes "materials and labour, times two, plus ten percent
-- overhead". Both numbers lived only in somebody's head, so nothing in the
-- app could work out a price -- it had a per-unit rate card instead, which is
-- a different way of pricing and the one being replaced.
--
-- Overhead is stored apart from the multiplier rather than folded into a
-- single 2.2, because the business states them separately and a lone 2.2 is
-- neither recognisable as their own pricing nor correctable without doing
-- arithmetic first. It is charged on the multiplied figure, not the raw cost.
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS price_multiplier NUMERIC NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS overhead_percent NUMERIC NOT NULL DEFAULT 10;
