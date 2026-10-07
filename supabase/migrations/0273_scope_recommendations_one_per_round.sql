-- One recommendation per zone per round. Two screens opening the same
-- review at once wrote two first drafts for the same zone.
delete from scope_recommendations a
using scope_recommendations b
where a.job_id = b.job_id and a.zone_index = b.zone_index and a.round = b.round and a.created_at > b.created_at;

create unique index if not exists scope_recommendations_one_per_round
  on scope_recommendations (job_id, zone_index, round);
