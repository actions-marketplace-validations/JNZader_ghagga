# Database — Provider Chain Schema

## Purpose

Define the data model changes to `repositories` table that support a configurable LLM provider chain with priority ordering and a static-only review mode.

## Requirements

### Requirement: Provider Chain Storage

The `repositories` table MUST store a `provider_chain` column of type JSONB, containing an ordered array of provider configurations.

Each entry in the array MUST contain:
- `provider`: one of `'anthropic'`, `'openai'`, `'google'`, `'github'`
- `model`: a string identifying the model (e.g., `'gpt-4o-mini'`)
- `encryptedApiKey`: a string with the AES-256-GCM encrypted key, or `null` for providers that use the session token (GitHub Models)

The array order defines the fallback priority (index 0 = primary).

#### Scenario: New repository gets empty provider chain

- GIVEN a new GitHub App installation event with a repository
- WHEN the repository is created in the database
- THEN `provider_chain` MUST be set to `[]` (empty array)
- AND `ai_review_enabled` MUST be set to `true`

#### Scenario: Provider chain stores multiple providers in order

- GIVEN a repository with id=1
- WHEN the user saves a chain of [GitHub Models (gpt-4o-mini), OpenAI (gpt-4o)]
- THEN `provider_chain` MUST be stored as a JSONB array with 2 entries
- AND the first entry MUST have `provider: 'github'` and `encryptedApiKey: null`
- AND the second entry MUST have `provider: 'openai'` and a non-null `encryptedApiKey`

### Requirement: AI Review Toggle

The `repositories` table MUST have an `ai_review_enabled` column of type boolean, defaulting to `true`.

#### Scenario: AI review disabled

- GIVEN a repository with `ai_review_enabled = false`
- WHEN a PR webhook triggers a review
- THEN the pipeline MUST skip all LLM agent calls
- AND MUST still run enabled static analysis tools

#### Scenario: AI review enabled with empty chain

- GIVEN a repository with `ai_review_enabled = true` and `provider_chain = []`
- WHEN a PR webhook triggers a review
- THEN the pipeline MUST treat it as if AI review is disabled
- AND MUST log a warning about misconfiguration

### Requirement: Migration from Flat Columns

The database migration MUST preserve existing data by converting the old flat columns into the new provider chain format.

#### Scenario: Migrate repo with existing provider config

- GIVEN a repository with `llm_provider = 'openai'`, `llm_model = 'gpt-4o'`, `encrypted_api_key = 'enc_xyz...'`
- WHEN the migration runs
- THEN `provider_chain` MUST be set to `[{ provider: 'openai', model: 'gpt-4o', encryptedApiKey: 'enc_xyz...' }]`
- AND `ai_review_enabled` MUST be set to `true`

#### Scenario: Migrate repo with no provider config

- GIVEN a repository with `llm_provider = 'github'`, `llm_model = null`, `encrypted_api_key = null`
- WHEN the migration runs
- THEN `provider_chain` MUST be set to `[{ provider: 'github', model: 'gpt-4o-mini', encryptedApiKey: null }]`
- AND `ai_review_enabled` MUST be set to `true`

#### Scenario: Old columns preserved for rollback

- GIVEN the migration has run successfully
- WHEN the old columns (`llm_provider`, `llm_model`, `encrypted_api_key`) are inspected
- THEN they MUST still exist in the table (not dropped)
- AND their data MUST be unchanged

### Requirement: Provider Chain Update

The system MUST support updating the provider chain for a repository via `updateRepoSettings()`.

#### Scenario: Replace entire provider chain

- GIVEN a repository with a chain of [GitHub Models]
- WHEN `updateRepoSettings()` is called with a new chain of [Anthropic, OpenAI]
- THEN the stored `provider_chain` MUST be replaced entirely with the new chain
- AND `updatedAt` MUST be set to the current timestamp

#### Scenario: Toggle AI review off

- GIVEN a repository with `ai_review_enabled = true`
- WHEN `updateRepoSettings()` is called with `{ aiReviewEnabled: false }`
- THEN `ai_review_enabled` MUST be set to `false`
- AND the `provider_chain` MUST remain unchanged
