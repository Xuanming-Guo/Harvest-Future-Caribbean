-- Structured, actionable reasons for rejections and change requests.
-- Every column is nullable so rows recorded before this migration keep
-- serializing without a reason.
ALTER TABLE "delivery_acceptances"
ADD COLUMN "reason_code" TEXT,
ADD COLUMN "next_action" TEXT;

ALTER TABLE "verification_tasks"
ADD COLUMN "reason_code" TEXT,
ADD COLUMN "next_action" TEXT;

ALTER TABLE "approvals"
ADD COLUMN "reason_code" TEXT,
ADD COLUMN "next_action" TEXT;
