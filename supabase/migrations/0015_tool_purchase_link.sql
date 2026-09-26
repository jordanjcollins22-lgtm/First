-- A link to where a tool can be bought, same as materials already have.

alter table tools add column if not exists purchase_url text;
