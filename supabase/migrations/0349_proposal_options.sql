-- Choices offered on one proposal, such as a basic and a full-service
-- version of the same job: each with its price, what it includes and what it
-- leaves out, and each area's price and services under it. The client picks
-- one when they accept, and the proposal takes that option's price.
-- Null on a proposal with a single price.
alter table job_proposals add column if not exists options jsonb;
