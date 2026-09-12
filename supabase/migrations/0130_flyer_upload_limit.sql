-- A size ceiling on advertiser artwork.
--
-- The file used to travel through a Server Action, which capped it at a
-- megabyte by accident and broke every photo taken on a phone. It goes
-- straight to storage now, so the ceiling has to be set where the file
-- actually lands rather than left to a limit nobody chose.
--
-- 25MB: a 300 DPI print file at this size is a few megabytes, and a phone
-- photograph is rarely more than eight.

update storage.buckets
set file_size_limit = 26214400,
    allowed_mime_types = array['image/png', 'image/jpeg', 'application/pdf']
where id = 'flyer-ads';

notify pgrst, 'reload schema';
