-- Who actually does evaluations, said outright.
--
-- It was inferred from role names: anybody called "evaluator" or "account
-- manager" could be booked, and nobody else. That inference is wrong in both
-- directions here, and both directions cost something.
--
-- The owner does evaluations and is only ever going to be called "admin", so
-- the public booking page would not offer him at all -- the person who does
-- half the evaluations was unbookable. And an evaluation had been sitting on a
-- crew member for a month because nothing stopped it being assigned there.
--
-- Role names are free text an organisation defines for itself, so they will
-- never reliably answer "can this person be sent to a house". A column can.
-- Null keeps the old behaviour, so nobody who has not thought about it loses
-- anything; true and false are somebody having thought about it, and win.
alter table profiles add column if not exists does_evaluations boolean;

comment on column profiles.does_evaluations is
  'Whether this person can be booked for an evaluation. Null falls back to the role names (evaluator or account manager); true and false are a decision somebody made and override it.';

notify pgrst, 'reload schema';
