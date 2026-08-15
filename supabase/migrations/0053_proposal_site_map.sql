-- The proposal's site reference image now shows the drawn work-area outlines,
-- not just the bare satellite photo — needs the same image transform the
-- canvas board itself uses (translate/rotate/scale) to place zones correctly
-- over the image. scope_snapshot entries also start including each zone's
-- `points` and `color` (no schema change needed there — it's already jsonb).

alter table job_proposals add column if not exists site_image_transform jsonb;
