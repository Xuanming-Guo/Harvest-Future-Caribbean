ALTER TABLE "simulation_runs"
ADD COLUMN "decision_adapter" TEXT NOT NULL DEFAULT 'deterministic';
