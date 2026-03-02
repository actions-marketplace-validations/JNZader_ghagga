/**
 * LLM Provider factory using the Vercel AI SDK.
 *
 * Wraps @ai-sdk/anthropic, @ai-sdk/openai, and @ai-sdk/google
 * behind a unified factory so the rest of the codebase doesn't
 * need to know which provider is being used.
 */

import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import type { LanguageModel } from 'ai';
import type { LLMProvider } from '../types.js';

// ─── Provider Factory ───────────────────────────────────────────

/**
 * Create a provider instance configured with the given API key.
 *
 * Returns the provider's model creator function, which can be called
 * with a model ID to get a LanguageModel instance.
 *
 * @param provider - Provider name ('anthropic' | 'openai' | 'google')
 * @param apiKey - Decrypted API key for the provider
 * @returns The provider's model creator function
 */
export function createProvider(
  provider: LLMProvider,
  apiKey: string,
) {
  switch (provider) {
    case 'anthropic':
      return createAnthropic({ apiKey });
    case 'openai':
      return createOpenAI({ apiKey });
    case 'google':
      return createGoogleGenerativeAI({ apiKey });
    default: {
      // Exhaustive check — TypeScript will error if a provider is missing
      const _exhaustive: never = provider;
      throw new Error(`Unknown provider: ${_exhaustive}`);
    }
  }
}

// ─── Model Factory ──────────────────────────────────────────────

/**
 * Create a LanguageModel instance for the given provider + model combo.
 *
 * This is the primary entry point for the rest of the codebase.
 * It handles provider initialization and model creation in one step.
 *
 * @param provider - Provider name
 * @param model - Model identifier (e.g., "claude-sonnet-4-20250514")
 * @param apiKey - Decrypted API key
 * @returns A LanguageModel ready for use with AI SDK's generateText/streamText
 */
export function createModel(
  provider: LLMProvider,
  model: string,
  apiKey: string,
): LanguageModel {
  const providerInstance = createProvider(provider, apiKey);
  return providerInstance(model) as LanguageModel;
}
