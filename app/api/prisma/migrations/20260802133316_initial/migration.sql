-- CreateEnum
CREATE TYPE "ActorRole" AS ENUM ('FARMER', 'BUYER', 'TRANSPORTER', 'COORDINATOR', 'OPERATIONS', 'ADMIN');

-- CreateEnum
CREATE TYPE "Provenance" AS ENUM ('OBSERVED', 'INFERRED', 'SYNTHETIC', 'STAKEHOLDER_CALIBRATED', 'MODEL_PREDICTED');

-- CreateTable
CREATE TABLE "actors" (
    "id" UUID NOT NULL,
    "auth_subject" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "ActorRole" NOT NULL,
    "is_synthetic" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "actors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "farms" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "farmer_id" UUID NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "farms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "farm_permissions" (
    "id" UUID NOT NULL,
    "farm_id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "role" "ActorRole" NOT NULL,

    CONSTRAINT "farm_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crop_batches" (
    "id" UUID NOT NULL,
    "farm_id" UUID NOT NULL,
    "crop_type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "available_to_promise" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "provenance" "Provenance" NOT NULL,
    "latest_observation_id" UUID,
    "latest_prediction_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "crop_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crop_observations" (
    "id" UUID NOT NULL,
    "crop_batch_id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "observed_at" TIMESTAMPTZ(3) NOT NULL,
    "recorded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "crop_stage" TEXT NOT NULL,
    "notes" TEXT,
    "estimated_quantity" DOUBLE PRECISION,
    "provenance" "Provenance" NOT NULL,
    "trace_id" UUID NOT NULL,

    CONSTRAINT "crop_observations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "yield_predictions" (
    "id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "crop_batch_id" UUID NOT NULL,
    "model_version" TEXT NOT NULL,
    "q10" DOUBLE PRECISION NOT NULL,
    "q50" DOUBLE PRECISION NOT NULL,
    "q90" DOUBLE PRECISION NOT NULL,
    "harvest_start" DATE NOT NULL,
    "harvest_end" DATE NOT NULL,
    "readiness" DOUBLE PRECISION NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "warnings" JSONB NOT NULL,
    "feature_snapshot" JSONB NOT NULL,
    "provenance" "Provenance" NOT NULL DEFAULT 'MODEL_PREDICTED',
    "generated_at" TIMESTAMPTZ(3) NOT NULL,
    "actual_quantity" DOUBLE PRECISION,
    "absolute_error" DOUBLE PRECISION,

    CONSTRAINT "yield_predictions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "listings" (
    "id" UUID NOT NULL,
    "crop_batch_id" UUID NOT NULL,
    "farmer_id" UUID NOT NULL,
    "crop_type" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "unit_price" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'XCD',
    "available_from" DATE NOT NULL,
    "available_until" DATE NOT NULL,
    "status" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "listings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "buyer_demands" (
    "id" UUID NOT NULL,
    "buyer_id" UUID NOT NULL,
    "crop_type" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "needed_by" TIMESTAMPTZ(3) NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "max_unit_price" DOUBLE PRECISION,
    "currency" TEXT DEFAULT 'XCD',
    "status" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "buyer_demands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" UUID NOT NULL,
    "buyer_id" UUID NOT NULL,
    "crop_type" TEXT NOT NULL,
    "requested_quantity" DOUBLE PRECISION NOT NULL,
    "accepted_quantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "needed_by" TIMESTAMPTZ(3) NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "listing_ids" JSONB NOT NULL,
    "lifecycle_status" TEXT NOT NULL,
    "at_risk" BOOLEAN NOT NULL DEFAULT false,
    "active_exception_ids" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "allocations" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "status" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "allocation_lines" (
    "id" UUID NOT NULL,
    "allocation_id" UUID NOT NULL,
    "crop_batch_id" UUID NOT NULL,
    "listing_id" UUID NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "allocation_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reservations" (
    "id" UUID NOT NULL,
    "allocation_id" UUID NOT NULL,
    "crop_batch_id" UUID NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approvals" (
    "id" UUID NOT NULL,
    "subject_type" TEXT NOT NULL,
    "subject_id" UUID NOT NULL,
    "status" TEXT NOT NULL,
    "requested_at" TIMESTAMPTZ(3) NOT NULL,
    "decided_by" UUID,
    "decided_at" TIMESTAMPTZ(3),
    "reason" TEXT,

    CONSTRAINT "approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_missions" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "status" TEXT NOT NULL,
    "transporter_id" UUID,
    "vehicle_id" UUID,
    "quantity" DOUBLE PRECISION NOT NULL,
    "deadline" TIMESTAMPTZ(3) NOT NULL,
    "stops" JSONB NOT NULL,

    CONSTRAINT "delivery_missions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_updates" (
    "id" UUID NOT NULL,
    "mission_id" UUID NOT NULL,
    "update_type" TEXT NOT NULL,
    "recorded_at" TIMESTAMPTZ(3) NOT NULL,
    "position" JSONB,
    "quantity" DOUBLE PRECISION,
    "note" TEXT,

    CONSTRAINT "delivery_updates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operational_exceptions" (
    "id" UUID NOT NULL,
    "exception_type" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "affected_entity_ids" JSONB NOT NULL,
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "provenance" "Provenance" NOT NULL,
    "reported_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "operational_exceptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_acceptances" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "outcome" TEXT NOT NULL,
    "accepted_quantity" DOUBLE PRECISION NOT NULL,
    "rejected_quantity" DOUBLE PRECISION NOT NULL,
    "note" TEXT,
    "accepted_by" UUID NOT NULL,
    "accepted_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "delivery_acceptances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_traces" (
    "id" UUID NOT NULL,
    "subject_type" TEXT NOT NULL,
    "subject_id" UUID NOT NULL,
    "status" TEXT NOT NULL,
    "summary" TEXT NOT NULL,

    CONSTRAINT "agent_traces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trace_steps" (
    "id" UUID NOT NULL,
    "trace_id" UUID NOT NULL,
    "recorded_at" TIMESTAMPTZ(3) NOT NULL,
    "kind" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION,

    CONSTRAINT "trace_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "simulation_runs" (
    "id" UUID NOT NULL,
    "scenario_id" TEXT NOT NULL,
    "policy" TEXT NOT NULL,
    "seed" BIGINT NOT NULL,
    "speed" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL,
    "current_time" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "world" JSONB NOT NULL,

    CONSTRAINT "simulation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "paired_runs" (
    "id" UUID NOT NULL,
    "scenario_id" TEXT NOT NULL,
    "seed" BIGINT NOT NULL,
    "baseline_run_id" UUID NOT NULL,
    "harvest_run_id" UUID NOT NULL,
    "status" TEXT NOT NULL,
    "result" JSONB,

    CONSTRAINT "paired_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "domain_events" (
    "cursor" BIGSERIAL NOT NULL,
    "id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "simulation_time" TIMESTAMPTZ(3),
    "simulation_run_id" UUID,
    "actor_id" UUID NOT NULL,
    "entity_id" UUID NOT NULL,
    "trace_id" UUID NOT NULL,
    "correlation_id" UUID NOT NULL,
    "causation_id" UUID,
    "schema_version" TEXT NOT NULL DEFAULT '1.0',
    "provenance" "Provenance" NOT NULL,
    "payload" JSONB NOT NULL,

    CONSTRAINT "domain_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_records" (
    "id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "status_code" INTEGER NOT NULL,
    "response_body" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "actors_auth_subject_key" ON "actors"("auth_subject");

-- CreateIndex
CREATE UNIQUE INDEX "farm_permissions_farm_id_actor_id_key" ON "farm_permissions"("farm_id", "actor_id");

-- CreateIndex
CREATE UNIQUE INDEX "domain_events_cursor_key" ON "domain_events"("cursor");

-- CreateIndex
CREATE INDEX "domain_events_cursor_idx" ON "domain_events"("cursor");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_records_actor_id_method_path_key_key" ON "idempotency_records"("actor_id", "method", "path", "key");
