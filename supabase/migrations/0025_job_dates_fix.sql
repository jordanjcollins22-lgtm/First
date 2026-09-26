alter table jobs alter column evaluation_date type timestamptz using evaluation_date::timestamptz;
alter table jobs add column if not exists project_end_date date;
