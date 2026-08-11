-- Lightweight, provider-neutral agent coordination records.
CREATE TABLE "crop_observation_intakes" (
    "id" UUID NOT NULL,
    "crop_batch_id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "observed_at" TIMESTAMPTZ(3) NOT NULL,
    "source_type" TEXT NOT NULL,
    "source_text" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "suggested_crop_stage" TEXT,
    "suggested_quantity" DOUBLE PRECISION,
    "suggested_notes" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL,
    "field_confidence" JSONB NOT NULL,
    "warnings" JSONB NOT NULL,
    "prompt_id" TEXT NOT NULL,
    "adapter" TEXT NOT NULL,
    "provenance" "Provenance" NOT NULL,
    "trace_id" UUID NOT NULL,
    "confirmed_observation_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmed_at" TIMESTAMPTZ(3),
    CONSTRAINT "crop_observation_intakes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "crop_observation_intakes_crop_batch_id_created_at_idx"
ON "crop_observation_intakes"("crop_batch_id", "created_at");

ALTER TABLE "orders" ADD COLUMN "trace_id" UUID;

ALTER TABLE "delivery_missions"
ADD COLUMN "estimated_distance_km" DOUBLE PRECISION,
ADD COLUMN "estimated_duration_minutes" INTEGER,
ADD COLUMN "estimated_arrival" TIMESTAMPTZ(3);

ALTER TABLE "operational_exceptions" ADD COLUMN "trace_id" UUID;

ALTER TABLE "agent_traces"
ADD COLUMN "workflow_type" TEXT NOT NULL DEFAULT 'GENERAL',
ADD COLUMN "stage" TEXT NOT NULL DEFAULT 'RECORDED',
ADD COLUMN "parent_trace_id" UUID,
ADD COLUMN "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "trace_steps"
ADD COLUMN "agent_name" TEXT,
ADD COLUMN "tool_name" TEXT,
ADD COLUMN "provenance" "Provenance",
ADD COLUMN "prompt_id" TEXT,
ADD COLUMN "adapter" TEXT,
ADD COLUMN "duration_ms" INTEGER;
