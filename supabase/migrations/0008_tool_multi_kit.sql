-- A tool can belong to more than one kit, so replace the single `kit` text
-- column with a `kits` text array.

alter table tools add column if not exists kits text[] not null default '{}';
update tools set kits = array[kit] where kit is not null and kits = '{}';
alter table tools drop column if exists kit;
