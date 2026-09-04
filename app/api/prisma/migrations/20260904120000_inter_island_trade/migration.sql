-- Scoped inter-island trade, shipping and regional coordination (#40).
--
-- Two tables, because they are two different things with two different rules.
--
-- inter_island_commitments is a *promise*, and it is the row the human approval
-- boundary hangs off. bound_at stays null until every approval on the
-- commitment has been granted, and the API refuses to create a shipment against
-- a commitment whose bound_at is null. That is what stops an inter-island
-- commitment from binding anyone without approval.
--
-- maritime_shipments is the *movement*, and it cannot exist without an approved
-- commitment.
--
-- The route columns (link, ports, operator, published sailing time) are PUBLIC
-- REFERENCE copied from the reviewed offline dataset
-- simulation/data/caribbean-maritime-network.v1.json, and network_references
-- carries their source, licence and retrieval date. Quantities, costs,
-- capacities, schedules, customs behaviour and outcomes are SYNTHETIC. A route
-- existing is not evidence that a produce service on it exists.
CREATE TABLE "inter_island_commitments" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "status" TEXT NOT NULL,
    "origin_island_id" TEXT NOT NULL,
    "destination_island_id" TEXT NOT NULL,
    "link_id" TEXT NOT NULL,
    "origin_port_id" TEXT NOT NULL,
    "destination_port_id" TEXT NOT NULL,
    "operator" TEXT NOT NULL,
    "sea_leg_hours" DOUBLE PRECISION NOT NULL,
    "journey_hours_source" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "cost_xcd" DOUBLE PRECISION NOT NULL,
    "local_currency" TEXT NOT NULL,
    "local_cost_amount" DOUBLE PRECISION NOT NULL,
    "units_per_xcd" DOUBLE PRECISION NOT NULL,
    "rate_as_of" TEXT NOT NULL,
    "lines" JSONB NOT NULL,
    "network_references" JSONB NOT NULL,
    "bound_at" TIMESTAMPTZ(3),
    "trace_id" UUID,
    "simulation_run_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "inter_island_commitments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "inter_island_commitments_order_id_idx" ON "inter_island_commitments"("order_id");

CREATE TABLE "maritime_shipments" (
    "id" UUID NOT NULL,
    "commitment_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "status" TEXT NOT NULL,
    "capacity_kg" DOUBLE PRECISION NOT NULL,
    "loaded_kg" DOUBLE PRECISION NOT NULL,
    "legs" JSONB NOT NULL,
    "customs" JSONB NOT NULL,
    "scheduled_departure_at" TIMESTAMPTZ(3) NOT NULL,
    "scheduled_arrival_at" TIMESTAMPTZ(3) NOT NULL,
    "actual_departure_at" TIMESTAMPTZ(3),
    "actual_arrival_at" TIMESTAMPTZ(3),
    "delivered_at" TIMESTAMPTZ(3),
    "failure_reason" TEXT,
    "weather_delay_hours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "simulation_shipment_id" TEXT,
    "simulation_run_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "maritime_shipments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "maritime_shipments_order_id_idx" ON "maritime_shipments"("order_id");
CREATE INDEX "maritime_shipments_commitment_id_idx" ON "maritime_shipments"("commitment_id");
