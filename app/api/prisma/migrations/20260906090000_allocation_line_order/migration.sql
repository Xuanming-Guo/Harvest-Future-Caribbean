-- Persist a total order independent of random public UUIDs. Existing rows receive
-- a one-time order; their original creation order was not recorded and cannot be
-- reconstructed reliably. New proposal lines receive sequence values in insertion
-- order, including the ordered VALUES list used by createMany.
ALTER TABLE "allocation_lines" ADD COLUMN "creation_order" BIGSERIAL NOT NULL;
CREATE UNIQUE INDEX "allocation_lines_creation_order_key" ON "allocation_lines"("creation_order");
