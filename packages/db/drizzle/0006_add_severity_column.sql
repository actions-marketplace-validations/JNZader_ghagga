-- Add severity column to memory_observations.
-- Stores the finding severity (critical/high/medium/low/info) for observations
-- persisted from review findings. Nullable because summary observations have no severity.

ALTER TABLE "memory_observations" ADD COLUMN IF NOT EXISTS "severity" varchar(10);
