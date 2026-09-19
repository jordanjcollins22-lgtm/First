-- The types and colors a material actually comes in, set once on the material
-- itself. The evaluator is only asked to pick when a material has options —
-- no point asking what color a bag of concrete should be.
alter table materials add column if not exists type_options text[] not null default '{}';
alter table materials add column if not exists color_options text[] not null default '{}';
