-- Fix FK constraint on memory_observations.session_id to use CASCADE delete.
-- The initial migration (0000) created this with ON DELETE no action,
-- but the Drizzle schema specifies onDelete: 'cascade'. This mismatch
-- causes a FK violation error when deleting sessions that have observations.

ALTER TABLE "memory_observations"
  DROP CONSTRAINT "memory_observations_session_id_memory_sessions_id_fk";

ALTER TABLE "memory_observations"
  ADD CONSTRAINT "memory_observations_session_id_memory_sessions_id_fk"
  FOREIGN KEY ("session_id")
  REFERENCES "public"."memory_sessions"("id")
  ON DELETE CASCADE ON UPDATE NO ACTION;
