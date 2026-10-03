-- Track whether a canvas image was uploaded by the user or fetched from satellite.
-- This is needed to preserve the correct zoom behavior when reloading a design,
-- since uploads use fitWhole zoom bounds while satellite images use cover bounds.
ALTER TABLE canvas_designs ADD COLUMN image_uploaded BOOLEAN NOT NULL DEFAULT false;
