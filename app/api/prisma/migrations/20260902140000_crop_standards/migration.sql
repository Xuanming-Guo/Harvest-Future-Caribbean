-- CreateTable
CREATE TABLE "crop_standards" (
    "id" UUID NOT NULL,
    "crop_type" TEXT NOT NULL,
    "publisher_actor_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "reviewed_at" TIMESTAMPTZ(3) NOT NULL,
    "geography" TEXT NOT NULL,
    "source" JSONB NOT NULL,
    "checklist" JSONB NOT NULL,
    "images" JSONB NOT NULL,
    "guidance" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crop_standards_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "orders" ADD COLUMN "crop_standard_id" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "crop_standards_publisher_actor_id_crop_type_version_key" ON "crop_standards"("publisher_actor_id", "crop_type", "version");

-- CreateIndex
CREATE INDEX "crop_standards_crop_type_status_created_at_idx" ON "crop_standards"("crop_type", "status", "created_at");
