-- Email is an identity, and identities are case-insensitive in practice. Storing the
-- caller's casing let `A@x.com` and `a@x.com` become two accounts, and made the OAuth
-- callback's `email = $1` lookup miss an account that already existed.
--
-- This migration refuses rather than guesses. Two accounts that differ only by case are
-- a decision about people's data, not something a migration may resolve by picking a
-- winner -- exactly the stance 0015 takes when it cannot collapse a row losslessly.
DO $$
DECLARE
  collisions text;
BEGIN
  -- Aggregate OUTSIDE the grouping. Aggregating inside it produces one row per colliding
  -- group, and plpgsql's non-STRICT SELECT INTO keeps only the first -- so the operator
  -- would be told one address while the message promised "these addresses", and would
  -- have to re-run the migration once per collision to discover them all.
  SELECT string_agg(e, ', ')
    INTO collisions
    FROM (
      SELECT lower(email) AS e
        FROM "users"
       GROUP BY 1
      HAVING count(*) > 1
    ) AS colliding;

  IF collisions IS NOT NULL THEN
    RAISE EXCEPTION
      'Cannot lowercase emails: these addresses would collide: %. Resolve them by hand, then re-run.',
      collisions;
  END IF;
END $$;

DO $$
DECLARE
  changed integer;
BEGIN
  UPDATE "users" SET "email" = lower("email") WHERE "email" <> lower("email");
  GET DIAGNOSTICS changed = ROW_COUNT;
  RAISE NOTICE 'Lowercased % email address(es).', changed;
END $$;

-- Structural, not conventional: the schema now refuses a duplicate regardless of which
-- code path writes it.
CREATE UNIQUE INDEX "users_email_lower_idx" ON "users" (lower("email"));

-- Once the expression index above enforces case-insensitive uniqueness, the original
-- exact-match constraint from 0000 is a strict subset of it: nothing that violates
-- case-insensitive uniqueness can ever pass it, and everything it would forbid, the new
-- index already forbids. Keeping both means Postgres decides which constraint reports a
-- collision essentially by index creation order (it picks this older one first for an
-- exact-case duplicate), so `isUniqueViolation(err, USERS_EMAIL_LOWER_INDEX)` in the
-- register route would never match and a raced duplicate would surface as a 500 again --
-- the very failure this migration exists to close. Dropping it makes the new index the
-- single source of truth its own comment above claims it to be.
-- `IF EXISTS` because the constraint's presence depends on how the database was
-- provisioned: `drizzle-kit push` builds the schema from `schema.ts` and never creates
-- the named constraint `0000` did, so on a pushed database this statement would abort the
-- migration over the absence of something it wanted gone anyway.
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_email_unique";
