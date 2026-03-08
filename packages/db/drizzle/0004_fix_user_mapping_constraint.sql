-- Migration: Change UNIQUE constraint on github_user_mappings
-- FROM: UNIQUE(github_user_id) — allows only one mapping per user
-- TO:   UNIQUE(github_user_id, installation_id) — allows one mapping per user+installation pair
--
-- This supports users with multiple installations (personal + organization).
-- Existing data is safe: the old constraint is stricter, so no duplicates exist.
--
-- Reversible: DROP "uq_user_installation", ADD UNIQUE("github_user_id")

-- Drop the old UNIQUE constraint on github_user_id only
ALTER TABLE "github_user_mappings" DROP CONSTRAINT IF EXISTS "github_user_mappings_github_user_id_unique";

-- Add composite UNIQUE constraint on (github_user_id, installation_id)
ALTER TABLE "github_user_mappings"
  DROP CONSTRAINT IF EXISTS "uq_user_installation";
ALTER TABLE "github_user_mappings"
  ADD CONSTRAINT "uq_user_installation" UNIQUE ("github_user_id", "installation_id");
