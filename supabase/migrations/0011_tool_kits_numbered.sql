-- Kits are identified by number (Kit 1, Kit 2, ...), not a free-text name.
-- Existing free-text kit names don't map to numbers, so this resets kit
-- assignments -- tools will need to be re-added to a numbered kit.

alter table tools drop column if exists kits;
alter table tools add column kits integer[] not null default '{}';
