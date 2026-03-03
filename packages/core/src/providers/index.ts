/**
 * LLM Provider factory using the Vercel AI SDK.
 *
 * Wraps @ai-sdk/anthropic, @ai-sdk/openai, @ai-sdk/google,
 * GitHub Models, and Ollama behind a unified factory so the rest
 * of the codebase doesn't need to know which provider is being used.
 *
 * GitHub Models uses the OpenAI-compatible endpoint at
 * https://models.inference.ai.azure.com and authenticates with a
 * GitHub Personal Access Token (PAT) with `models:read` scope.
 *
 * Ollama runs locally and exposes an OpenAI-compatible endpoint at
 * http://localhost:11434/v1. No API key required.
 *
 * Qwen (Alibaba Cloud DashScope) uses the OpenAI-compatible endpoint at
 * https://dashscope-intl.aliyuncs.com/compatible-mode/v1. Requires a
 * DashScope API key (DASHSCOPE_API_KEY).
 */

import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import type { LanguageModel } from 'ai';
import type { LLMProvider } from '../types.js';

/** GitHub Models inference endpoint (OpenAI-compatible) */
const GITHUB_MODELS_BASE_URL = 'https://models.inference.ai.azure.com';

/** Ollama local inference endpoint (OpenAI-compatible) */
const OLLAMA_BASE_URL = 'http://localhost:11434/v1';

/** Qwen / DashScope international endpoint (OpenAI-compatible) */
const QWEN_BASE_URL = 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1';

// ─── Provider Factory ───────────────────────────────────────────

/**
 * Create a provider instance configured with the given API key.
 *
 * Returns the provider's model creator function, which can be called
 * with a model ID to get a LanguageModel instance.
 *
 * @param provider - Provider name ('anthropic' | 'openai' | 'google' | 'github' | 'ollama')
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
    case 'github':
      return createOpenAI({
        apiKey,
        baseURL: GITHUB_MODELS_BASE_URL,
        name: 'github-models',
      });
    case 'ollama':
      return createOpenAI({
        apiKey: apiKey || 'ollama',
        baseURL: OLLAMA_BASE_URL,
        name: 'ollama',
      });
    case 'qwen':
      return createOpenAI({
        apiKey,
        baseURL: QWEN_BASE_URL,
        name: 'qwen',
      });
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
