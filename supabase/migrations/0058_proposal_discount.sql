-- An optional discount an account manager can apply while reviewing a
-- proposal — shown to the client as its own line (subtotal, discount,
-- total) instead of just quietly editing the total. Defaults to 0/none so
-- existing and newly auto-generated proposals are unaffected until set.

alter table job_proposals add column if not exists discount_amount numeric not null default 0;
alter table job_proposals add column if not exists discount_reason text;
