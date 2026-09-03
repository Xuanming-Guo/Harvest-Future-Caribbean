-- Per-run harvest-estimation method (issue #51).
--
-- The choice belongs to a simulation run, not to server configuration, so it
-- is stored on the run and copied onto every forecast that run produced. Rows
-- written before this migration were all produced by the deterministic
-- fixture, so DETERMINISTIC_FALLBACK is the correct backfill rather than a
-- placeholder.
CREATE TYPE "EstimationMode" AS ENUM ('LEARNED_MODEL', 'DETERMINISTIC_FALLBACK');

ALTER TABLE "simulation_runs"
  ADD COLUMN "estimation_mode" "EstimationMode" NOT NULL DEFAULT 'DETERMINISTIC_FALLBACK';

ALTER TABLE "yield_predictions"
  ADD COLUMN "estimation_mode" "EstimationMode" NOT NULL DEFAULT 'DETERMINISTIC_FALLBACK';
