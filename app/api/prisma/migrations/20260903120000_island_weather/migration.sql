-- Observed island weather and the forecast issued with it (#37).
--
-- Only a day that has already occurred is written here. Realised weather for a
-- day that has not happened stays inside simulation truth, so this table is
-- structurally incapable of leaking future weather to a participant however the
-- endpoint over it is queried.
--
-- `forecast` is a JSON array of WeatherForecastDay as published by
-- contracts/openapi.yaml. It is stored beside the realised reading rather than
-- in its own table because a forecast is only meaningful next to the day it was
-- issued on, and nothing queries a forecast day independently.
--
-- Realised readings and forecasts carry separate provenance columns on purpose:
-- one is a synthetic record, the other a synthetic prediction.
CREATE TABLE "weather_observations" (
    "id" UUID NOT NULL,
    "island_id" TEXT NOT NULL,
    "observed_on" DATE NOT NULL,
    "condition" TEXT NOT NULL,
    "rain_mm" DOUBLE PRECISION NOT NULL,
    "wind_kph" DOUBLE PRECISION NOT NULL,
    "wind_from_degrees" DOUBLE PRECISION NOT NULL,
    "cloud_cover_fraction" DOUBLE PRECISION NOT NULL,
    "temp_band" TEXT NOT NULL,
    "provenance" "Provenance" NOT NULL,
    "forecast" JSONB NOT NULL,
    "forecast_provenance" "Provenance" NOT NULL,
    "simulation_run_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "weather_observations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "weather_observations_simulation_run_id_island_id_observed_o_key"
    ON "weather_observations"("simulation_run_id", "island_id", "observed_on");

CREATE INDEX "weather_observations_island_id_observed_on_idx"
    ON "weather_observations"("island_id", "observed_on");
