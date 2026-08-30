-- Part 2 of the 2026-08-30 redesign — remove the old image URL column.
--
-- IRREVERSIBLE. Existing rows lose their image links; a migration cannot fetch remote
-- URLs and re-host them (D9). The seed now ships real files through the storage provider,
-- so seeded data and uploaded data take one code path.
--
-- Deliberately separate from 0012: every consumer of image_url had to move to
-- listing_images first, and dropping it in the additive migration would have left the
-- tree broken between tasks.

ALTER TABLE "listings" DROP COLUMN IF EXISTS "image_url";
