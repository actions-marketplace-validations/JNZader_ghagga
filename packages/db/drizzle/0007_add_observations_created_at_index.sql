-- Add index on created_at for memory_observations.
-- Improves query performance for time-range filtering with large datasets.
CREATE INDEX IF NOT EXISTS "idx_observations_created_at"
  ON "memory_observations" USING btree ("created_at");
