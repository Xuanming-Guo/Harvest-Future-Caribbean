-- Forward promises: a crop can be promised before it is picked (#91).
--
-- `promisable_from` is the first date the produce on a batch can be handed
-- over: today for a batch reported harvest ready, and the start of the
-- forecast harvest window for one still growing. Available-to-promise no
-- longer collapses to zero for a growing batch, so the date is what keeps a
-- forward promise honest: a listing may not open before it, and matching will
-- not pair a listing with an order the produce cannot reach in time.
--
-- `collect_from` is the same fact carried on the mission: the first instant the
-- whole load is collectable. A transporter needs it to know that a job offered
-- today is a job for next week, and the simulated one uses it to avoid tying a
-- vehicle up for a fortnight before the field is pickable.
--
-- Both are nullable. Rows written before forecasts carried a window keep the
-- behaviour they had, which is "collectable now".
ALTER TABLE "crop_batches" ADD COLUMN "promisable_from" TIMESTAMPTZ(3);
ALTER TABLE "delivery_missions" ADD COLUMN "collect_from" TIMESTAMPTZ(3);
