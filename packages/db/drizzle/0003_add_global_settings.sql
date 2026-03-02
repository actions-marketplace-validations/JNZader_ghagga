-- Migration: Add global (installation-level) settings
-- Allows users to configure provider chain + settings once per installation,
-- with per-repo override capability.

-- 1. Create installation_settings table
CREATE TABLE IF NOT EXISTS installation_settings (
  id SERIAL PRIMARY KEY,
  installation_id INTEGER NOT NULL UNIQUE REFERENCES installations(id),
  provider_chain JSONB NOT NULL DEFAULT '[]',
  ai_review_enabled BOOLEAN NOT NULL DEFAULT true,
  review_mode VARCHAR(20) NOT NULL DEFAULT 'simple',
  settings JSONB NOT NULL DEFAULT '{"enableSemgrep":true,"enableTrivy":true,"enableCpd":true,"enableMemory":true,"customRules":[],"ignorePatterns":["*.md","*.txt",".gitignore","LICENSE","*.lock"],"reviewLevel":"normal"}',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- 2. Add use_global_settings column to repositories (default true)
ALTER TABLE repositories ADD COLUMN IF NOT EXISTS use_global_settings BOOLEAN NOT NULL DEFAULT true;

-- 3. Repos that already have a non-empty provider_chain should keep their custom settings
-- (set use_global_settings = false for them so they don't inherit)
UPDATE repositories
SET use_global_settings = false
WHERE provider_chain IS NOT NULL
  AND provider_chain::text != '[]'
  AND jsonb_array_length(provider_chain) > 0;
