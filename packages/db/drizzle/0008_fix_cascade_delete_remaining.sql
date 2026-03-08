-- Fix remaining FK constraints to use CASCADE delete.
-- When a GitHub App is uninstalled, the installation is deleted. Without cascade,
-- repositories, reviews, and user mappings become orphaned rows.
--
-- Affected constraints (all created in 0000 with ON DELETE no action):
--   1. repositories.installation_id → installations.id
--   2. reviews.repository_id → repositories.id
--   3. github_user_mappings.installation_id → installations.id

-- 1. repositories.installation_id → installations.id
ALTER TABLE "repositories"
  DROP CONSTRAINT IF EXISTS "repositories_installation_id_installations_id_fk";

ALTER TABLE "repositories"
  ADD CONSTRAINT "repositories_installation_id_installations_id_fk"
  FOREIGN KEY ("installation_id")
  REFERENCES "public"."installations"("id")
  ON DELETE CASCADE ON UPDATE NO ACTION;

-- 2. reviews.repository_id → repositories.id
ALTER TABLE "reviews"
  DROP CONSTRAINT IF EXISTS "reviews_repository_id_repositories_id_fk";

ALTER TABLE "reviews"
  ADD CONSTRAINT "reviews_repository_id_repositories_id_fk"
  FOREIGN KEY ("repository_id")
  REFERENCES "public"."repositories"("id")
  ON DELETE CASCADE ON UPDATE NO ACTION;

-- 3. github_user_mappings.installation_id → installations.id
ALTER TABLE "github_user_mappings"
  DROP CONSTRAINT IF EXISTS "github_user_mappings_installation_id_installations_id_fk";

ALTER TABLE "github_user_mappings"
  ADD CONSTRAINT "github_user_mappings_installation_id_installations_id_fk"
  FOREIGN KEY ("installation_id")
  REFERENCES "public"."installations"("id")
  ON DELETE CASCADE ON UPDATE NO ACTION;
