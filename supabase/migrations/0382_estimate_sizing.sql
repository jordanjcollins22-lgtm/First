-- The size each spot on a map estimate was priced at, and where that size
-- came from: drawn round on the map, read off the satellite picture and the
-- client's photos, this business's own measured jobs, or a share of the lot.
--
-- One entry per spot: { index, choices, areaSqft, count, source, confidence,
-- from, priceCents } (SpotSizing in src/lib/spot-sizing.ts). Kept beside the
-- price so the page can say how each spot was sized and the evaluator knows
-- which sizes to check at the visit. Null on estimates made before this.
alter table job_estimates add column if not exists sizing jsonb;
