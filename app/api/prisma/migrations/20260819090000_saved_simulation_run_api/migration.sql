CREATE TYPE "SimulationRunStatus" AS ENUM ('CREATING', 'COMPLETED', 'FAILED');
CREATE TYPE "SimulationDecisionMode" AS ENUM ('DETERMINISTIC', 'LLM_ASSISTED');
CREATE TYPE "PairedRunStatus" AS ENUM ('CREATING', 'COMPLETED', 'FAILED');

CREATE TABLE "simulation_runs" (
    "id" UUID NOT NULL,
    "scenario_id" TEXT NOT NULL,
    "policy" TEXT NOT NULL,
    "seed" BIGINT NOT NULL,
    "decision_mode" "SimulationDecisionMode" NOT NULL,
    "scope" JSONB NOT NULL,
    "resolved_island_ids" JSONB NOT NULL,
    "disruptions" JSONB NOT NULL,
    "derived_from_run_id" UUID,
    "status" "SimulationRunStatus" NOT NULL,
    "started_at" TIMESTAMPTZ(3),
    "ended_at" TIMESTAMPTZ(3),
    "frame_count" INTEGER NOT NULL DEFAULT 0,
    "metrics" JSONB,
    "decisions" JSONB,
    "evidence_label" TEXT,
    "provenance_note" TEXT,
    "determinism_digest" TEXT,
    "scene" JSONB,
    "frames" JSONB,
    "error_code" TEXT,
    "error_message" TEXT,
    "created_by_actor_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "simulation_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "simulation_actor_mappings" (
    "id" UUID NOT NULL,
    "simulation_run_id" UUID NOT NULL,
    "simulation_actor_id" UUID NOT NULL,
    "product_actor_id" UUID,
    "role" "ActorRole" NOT NULL,
    "display_name" TEXT NOT NULL,
    "island_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "simulation_actor_mappings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "paired_runs" (
    "id" UUID NOT NULL,
    "scenario_id" TEXT NOT NULL,
    "seed" BIGINT NOT NULL,
    "decision_mode" "SimulationDecisionMode" NOT NULL,
    "scope" JSONB NOT NULL,
    "resolved_island_ids" JSONB NOT NULL,
    "disruptions" JSONB NOT NULL,
    "baseline_run_id" UUID NOT NULL,
    "harvest_run_id" UUID NOT NULL,
    "status" "PairedRunStatus" NOT NULL,
    "comparison" JSONB,
    "evidence_label" TEXT,
    "error_code" TEXT,
    "error_message" TEXT,
    "created_by_actor_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "paired_runs_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "actors" ADD COLUMN "simulation_run_id" UUID;
ALTER TABLE "farms" ADD COLUMN "simulation_run_id" UUID;
ALTER TABLE "farm_permissions" ADD COLUMN "simulation_run_id" UUID;
ALTER TABLE "crop_batches" ADD COLUMN "simulation_run_id" UUID;
ALTER TABLE "crop_observations" ADD COLUMN "simulation_run_id" UUID;
ALTER TABLE "crop_observation_intakes" ADD COLUMN "simulation_run_id" UUID;
ALTER TABLE "verification_tasks" ADD COLUMN "simulation_run_id" UUID;
ALTER TABLE "yield_predictions" ADD COLUMN "simulation_run_id" UUID;
ALTER TABLE "listings" ADD COLUMN "simulation_run_id" UUID;
ALTER TABLE "buyer_demands" ADD COLUMN "simulation_run_id" UUID;
ALTER TABLE "orders" ADD COLUMN "simulation_run_id" UUID;
ALTER TABLE "allocations" ADD COLUMN "simulation_run_id" UUID;
ALTER TABLE "allocation_lines" ADD COLUMN "simulation_run_id" UUID;
ALTER TABLE "reservations" ADD COLUMN "simulation_run_id" UUID;
ALTER TABLE "approvals" ADD COLUMN "simulation_run_id" UUID;
ALTER TABLE "delivery_missions" ADD COLUMN "simulation_run_id" UUID;
ALTER TABLE "delivery_updates" ADD COLUMN "simulation_run_id" UUID;
ALTER TABLE "operational_exceptions" ADD COLUMN "simulation_run_id" UUID;
ALTER TABLE "delivery_acceptances" ADD COLUMN "simulation_run_id" UUID;
ALTER TABLE "vehicles" ADD COLUMN "simulation_run_id" UUID;
ALTER TABLE "agent_traces" ADD COLUMN "simulation_run_id" UUID;
ALTER TABLE "trace_steps" ADD COLUMN "simulation_run_id" UUID;
ALTER TABLE "idempotency_records" ADD COLUMN "simulation_run_id" UUID;

CREATE INDEX "simulation_runs_created_at_idx" ON "simulation_runs"("created_at");
CREATE INDEX "simulation_runs_scenario_id_policy_status_idx" ON "simulation_runs"("scenario_id", "policy", "status");
CREATE UNIQUE INDEX "simulation_actor_mappings_simulation_run_id_simulation_actor_id_key"
ON "simulation_actor_mappings"("simulation_run_id", "simulation_actor_id");
CREATE INDEX "simulation_actor_mappings_simulation_run_id_role_idx"
ON "simulation_actor_mappings"("simulation_run_id", "role");
CREATE INDEX "paired_runs_created_at_idx" ON "paired_runs"("created_at");
