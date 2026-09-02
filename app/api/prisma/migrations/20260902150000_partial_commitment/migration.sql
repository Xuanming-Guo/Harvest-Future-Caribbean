-- Safe partial commitment (#53).
--
-- `minimum_acceptable_fraction` is the smallest share of `requested_quantity`
-- a buyer will accept as a commitment. The 0.8 default is stakeholder
-- calibrated: hotel buyers reported that they routinely take part of an order
-- and source the remainder elsewhere rather than lose the whole delivery.
--
-- `committed_quantity` records what approval actually reserved, which is below
-- `requested_quantity` on a partial commitment. Existing rows keep 0 until an
-- allocation is approved, which matches their pre-migration meaning.
ALTER TABLE "orders" ADD COLUMN "committed_quantity" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "orders" ADD COLUMN "minimum_acceptable_fraction" DOUBLE PRECISION NOT NULL DEFAULT 0.8;
