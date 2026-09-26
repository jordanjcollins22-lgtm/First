-- Finding an address by typing part of it.
--
-- With the county loaded there are a hundred and seventeen thousand houses,
-- and the review screen wants "barton ct" to answer while a person is still
-- typing. A trigram index makes a contains-match on the normalized key an
-- index lookup rather than a scan of every row.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS houses_normalized_trgm_idx
  ON houses USING gin (normalized_address gin_trgm_ops);
