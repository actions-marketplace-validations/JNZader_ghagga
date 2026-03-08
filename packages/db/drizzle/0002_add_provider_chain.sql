-- Migration: Add provider_chain and ai_review_enabled to repositories
-- Non-breaking: adds new columns, migrates data, keeps old columns for rollback.

-- Step 1: Add new columns
ALTER TABLE "repositories"
  ADD COLUMN IF NOT EXISTS "provider_chain" jsonb DEFAULT '[]'::jsonb NOT NULL,
  ADD COLUMN IF NOT EXISTS "ai_review_enabled" boolean DEFAULT true NOT NULL;

--> statement-breakpoint

-- Step 2: Migrate existing data from flat columns into provider_chain
UPDATE "repositories"
SET "provider_chain" = jsonb_build_array(
  jsonb_build_object(
    'provider', "llm_provider",
    'model', COALESCE("llm_model", CASE
      WHEN "llm_provider" = 'github' THEN 'gpt-4o-mini'
      WHEN "llm_provider" = 'anthropic' THEN 'claude-sonnet-4-20250514'
      WHEN "llm_provider" = 'openai' THEN 'gpt-4o'
      WHEN "llm_provider" = 'google' THEN 'gemini-2.0-flash'
      ELSE 'gpt-4o-mini'
    END),
    'encryptedApiKey', "encrypted_api_key"
  )
)
WHERE "llm_provider" IS NOT NULL;
