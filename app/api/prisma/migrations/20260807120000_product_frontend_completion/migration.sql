-- Participant profile defaults used by the website and future mobile client.
ALTER TABLE "actors"
  ADD COLUMN "default_latitude" DOUBLE PRECISION,
  ADD COLUMN "default_longitude" DOUBLE PRECISION,
  ADD COLUMN "service_zone" TEXT;

ALTER TABLE "farms"
  ADD COLUMN "production_zone" TEXT NOT NULL DEFAULT 'Saint Lucia';

-- Transporters select a real, owned vehicle when accepting a mission.
CREATE TABLE "vehicles" (
  "id" UUID NOT NULL,
  "transporter_id" UUID NOT NULL,
  "label" TEXT NOT NULL,
  "registration_number" TEXT,
  "capacity_kg" DOUBLE PRECISION,
  "status" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "vehicles_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "vehicles_transporter_id_status_idx" ON "vehicles"("transporter_id", "status");

-- Coordinators receive explicit verification work instead of inferred missing-data cards.
CREATE TABLE "verification_tasks" (
  "id" UUID NOT NULL,
  "farm_id" UUID NOT NULL,
  "crop_batch_id" UUID NOT NULL,
  "subject_type" TEXT NOT NULL,
  "subject_id" UUID NOT NULL,
  "task_type" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolved_by" UUID,
  "resolved_at" TIMESTAMPTZ(3),
  "note" TEXT,
  CONSTRAINT "verification_tasks_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "verification_tasks_farm_id_status_idx" ON "verification_tasks"("farm_id", "status");
CREATE INDEX "verification_tasks_crop_batch_id_created_at_idx" ON "verification_tasks"("crop_batch_id", "created_at");

ALTER TABLE "delivery_missions"
  ADD COLUMN "current_stop_sequence" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "delivery_updates"
  ADD COLUMN "stop_sequence" INTEGER;

ALTER TABLE "operational_exceptions"
  ADD COLUMN "recovery_action" TEXT,
  ADD COLUMN "recovery_summary" TEXT,
  ADD COLUMN "recovery_changes" JSONB;

ALTER TABLE "delivery_acceptances"
  ADD COLUMN "line_outcomes" JSONB NOT NULL DEFAULT '[]';
CREATE UNIQUE INDEX "delivery_acceptances_order_id_key" ON "delivery_acceptances"("order_id");
