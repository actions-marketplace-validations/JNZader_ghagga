# Dashboard — Settings Page Redesign

## Purpose

Define the Settings page UI behavior for configuring the provider chain, API key validation, model selection, and the AI review toggle.

## Requirements

### Requirement: Static Analysis Section

The Settings page MUST display a "Static Analysis" section with toggleable tools, always visible regardless of AI review state.

#### Scenario: Toggle static tools

- GIVEN the user has selected a repository
- WHEN the Settings page loads
- THEN checkboxes for Semgrep, Trivy, and CPD MUST be visible
- AND their state MUST reflect the current saved settings

#### Scenario: Save with all static tools disabled

- GIVEN the user unchecks Semgrep, Trivy, and CPD
- WHEN the user clicks "Save Settings"
- THEN all three tools MUST be saved as disabled
- AND the review pipeline MUST skip all static analysis for this repo

### Requirement: AI Review Master Toggle

The Settings page MUST display an "AI Review" toggle that controls whether LLM-based review is enabled.

#### Scenario: AI review toggle off

- GIVEN the user toggles AI Review to OFF
- WHEN the toggle changes
- THEN the provider chain section MUST be hidden
- AND the review mode selector (simple/workflow/consensus) MUST be hidden
- AND saving settings MUST set `aiReviewEnabled: false`

#### Scenario: AI review toggle on

- GIVEN the user toggles AI Review to ON
- WHEN the toggle changes
- THEN the provider chain section MUST become visible
- AND the review mode selector MUST become visible

### Requirement: Provider Chain Editor

When AI Review is enabled, the Settings page MUST display an ordered list of provider configurations.

#### Scenario: Empty chain shows add button

- GIVEN a repo with an empty provider chain and AI review enabled
- WHEN the Settings page loads
- THEN an "Add Provider" button MUST be visible
- AND a help text SHOULD suggest adding at least one provider

#### Scenario: Add a provider

- GIVEN the provider chain is empty
- WHEN the user clicks "Add Provider"
- THEN a new row MUST appear with a provider dropdown, API key input, and a disabled model dropdown
- AND the provider dropdown MUST show: GitHub Models (Free), Anthropic, OpenAI, Google
- AND MUST NOT show Ollama

#### Scenario: Add a second provider as fallback

- GIVEN the chain has 1 provider (GitHub Models)
- WHEN the user clicks "Add Fallback Provider"
- THEN a second row MUST appear below the first
- AND it MUST be labeled as "#2" or "Fallback"

#### Scenario: Remove a provider from the chain

- GIVEN the chain has 2 providers
- WHEN the user clicks the remove button on the second provider
- THEN the second provider MUST be removed
- AND the first provider MUST remain unchanged

#### Scenario: Reorder providers

- GIVEN the chain has providers [GitHub Models, OpenAI]
- WHEN the user moves OpenAI up (via up arrow button)
- THEN the chain MUST become [OpenAI, GitHub Models]
- AND OpenAI MUST now be labeled as primary (#1)

### Requirement: API Key Validation Flow

Each provider entry MUST have a "Validate" button that tests the API key and, on success, populates the model dropdown.

#### Scenario: Validate OpenAI key successfully

- GIVEN the user selected provider "OpenAI" and entered API key "sk-live-valid"
- WHEN the user clicks "Validate"
- THEN a loading indicator MUST appear on the button
- AND on success, the model dropdown MUST become enabled
- AND the dropdown MUST be populated with the models returned by the server
- AND a green checkmark or "Valid" indicator MUST appear

#### Scenario: Validate with invalid key

- GIVEN the user entered an invalid API key
- WHEN the user clicks "Validate"
- THEN a red error message MUST appear (e.g., "Invalid API key")
- AND the model dropdown MUST remain disabled
- AND the previously selected model (if any) MUST be cleared

#### Scenario: GitHub Models validation (no API key needed)

- GIVEN the user selected provider "GitHub Models"
- WHEN the provider is selected
- THEN the API key input MUST NOT be shown (or MUST be disabled with help text: "Uses your GitHub session token")
- AND a "Validate" button MUST still be shown
- AND clicking validate MUST test the session token against GitHub Models
- AND on success, the model dropdown MUST populate with available models

#### Scenario: Re-validate after changing API key

- GIVEN the user previously validated a key and selected a model
- WHEN the user changes the API key text
- THEN the model dropdown MUST become disabled again
- AND the validation status MUST reset to "unvalidated"
- AND the user MUST click "Validate" again

### Requirement: Model Selection Dropdown

After successful validation, the model dropdown MUST show available models for that provider.

#### Scenario: Model dropdown shows provider-specific models

- GIVEN the OpenAI key was validated successfully
- WHEN the model dropdown is opened
- THEN it MUST show models returned by the validation endpoint (e.g., gpt-4o, gpt-4o-mini, gpt-4-turbo)
- AND the dropdown MUST be searchable or filterable if the list is long

#### Scenario: Previously saved model is pre-selected

- GIVEN a repo with a saved provider chain entry `{ provider: 'openai', model: 'gpt-4o' }`
- WHEN the Settings page loads
- THEN the model dropdown MUST show "gpt-4o" as selected
- AND the validation status MUST show as "validated" (assume saved keys are valid)

### Requirement: Review Mode Selector

The review mode (simple/workflow/consensus) MUST only be visible when AI Review is enabled.

#### Scenario: Select review mode

- GIVEN AI Review is enabled
- WHEN the user selects "workflow" mode
- THEN the radio button for "workflow" MUST be checked
- AND saving settings MUST persist `reviewMode: 'workflow'`

### Requirement: Settings Save Behavior

The Save button MUST send all settings in a single `PUT /api/settings` request.

#### Scenario: Save complete settings

- GIVEN the user configured: AI enabled, chain [GitHub gpt-4o-mini, OpenAI gpt-4o], Semgrep on, Trivy on, CPD off, workflow mode
- WHEN the user clicks "Save Settings"
- THEN a single `PUT /api/settings` request MUST be sent
- AND the request body MUST include all fields
- AND API keys for new/changed providers MUST be sent in plaintext (server encrypts)
- AND API keys for unchanged providers MUST NOT be sent (server preserves existing)
- AND on success, a "Settings saved!" message MUST appear

#### Scenario: Save with no changes

- GIVEN the user opened settings and made no changes
- WHEN the user clicks "Save Settings"
- THEN the request MUST still be sent (idempotent)
- AND the success message MUST appear

### Requirement: Loading and Error States

#### Scenario: Settings loading

- GIVEN the user selected a repo
- WHEN settings are being fetched
- THEN a loading spinner MUST be shown

#### Scenario: Save fails

- GIVEN the server returns a 500 error on save
- WHEN the save request fails
- THEN a red error message MUST appear (e.g., "Failed to save settings")
- AND the form MUST retain the user's unsaved changes (not reset)

#### Scenario: Validation endpoint unavailable

- GIVEN the server is unreachable
- WHEN the user clicks "Validate"
- THEN an error message MUST appear indicating the server cannot be reached
