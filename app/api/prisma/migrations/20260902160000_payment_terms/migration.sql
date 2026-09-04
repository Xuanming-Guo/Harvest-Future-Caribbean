-- Payment terms and status tracking (#74).
--
-- Harvest does not move money. These columns record the agreed term, what the
-- delivered produce was worth at its listing price, and the buyer's own
-- statement that it paid. Payment status itself is derived at read time from
-- the delivery acceptance time plus the term, so nothing here stores a status
-- that could go stale between requests.
--
-- The 14-day default is stakeholder calibrated, from farmer feedback that
-- hotels currently take one, two, or more months to pay.
ALTER TABLE "orders" ADD COLUMN "payment_terms_days" INTEGER NOT NULL DEFAULT 14;
ALTER TABLE "orders" ADD COLUMN "payment_amount" DOUBLE PRECISION;
ALTER TABLE "orders" ADD COLUMN "payment_currency" TEXT;
ALTER TABLE "orders" ADD COLUMN "paid_at" TIMESTAMPTZ(3);
ALTER TABLE "orders" ADD COLUMN "payment_reference" TEXT;
