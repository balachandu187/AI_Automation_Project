// ============================================================================
// FlowMind AI — Adapter Factory
// ============================================================================
// Creates the correct LLMProvider based on a string identifier.
// Handles API key routing from workspace config or environment variables.

import type { LLMProvider } from "./types.js";
import { OpenAIProvider } from "./openai.js";
import { AnthropicProvider } from "./anthropic.js";
import { GeminiProvider } from "./gemini.js";
import { FatalError } from "../../engine/errors.js";

/** Provider configuration per workspace */
export interface ProviderConfig {
  provider: string;
  apiKey?: string;
}

/** All provider identifiers */
export type ProviderId = "openai" | "anthropic" | "gemini";

/** Provider instance cache (singletons keyed by provider + apiKey prefix) */
const providerCache = new Map<string, LLMProvider>();

function cacheKey(provider: string, apiKey?: string): string {
  return `${provider}:${apiKey ? apiKey.slice(0, 8) : "env"}`;
}

/**
 * Create a provider instance from a provider identifier.
 * Reuses cached instances when possible.
 */
export function createProvider(
  providerId: ProviderId,
  apiKey?: string,
): LLMProvider {
  const key = cacheKey(providerId, apiKey);

  if (providerCache.has(key)) {
    return providerCache.get(key)!;
  }

  let provider: LLMProvider;

  switch (providerId) {
    case "openai":
      provider = new OpenAIProvider(apiKey);
      break;
    case "anthropic":
      provider = new AnthropicProvider(apiKey);
      break;
    case "gemini":
      provider = new GeminiProvider(apiKey);
      break;
    default:
      throw new FatalError(`Unknown provider: ${providerId}`);
  }

  providerCache.set(key, provider);
  return provider;
}

/**
 * Resolve a model identifier string to the correct provider.
 * Recognizes model prefixes:
 *   - "gpt-" → openai
 *   - "claude-" → anthropic
 *   - "gemini-" → gemini
 *   - "text-embedding-" → openai (embeddings)
 *
 * Returns the provider instance and the model name to use.
 */
export function resolveModelProvider(
  modelId: string,
  apiKeys?: Partial<Record<ProviderId, string>>,
): { provider: LLMProvider; model: string } {
  let providerId: ProviderId;
  let model = modelId;

  const lower = modelId.toLowerCase();

  if (lower.startsWith("gpt-") || lower.startsWith("o1-") || lower.startsWith("o3-") || lower.startsWith("text-embedding-")) {
    providerId = "openai";
  } else if (lower.startsWith("claude-")) {
    providerId = "anthropic";
  } else if (lower.startsWith("gemini-") || lower.startsWith("text-embedding-0")) {
    // "text-embedding-004" is Gemini's embedding model
    providerId = lower.startsWith("text-embedding-004") ? "gemini" : "gemini";
  } else {
    // Default fallback: try to match against known model catalogs
    const openaiProvider = createProvider("openai", apiKeys?.openai);
    const openaiModels = openaiProvider.modelList().map((m) => m.id);
    if (openaiModels.includes(modelId)) {
      providerId = "openai";
    } else {
      const anthropicProvider = createProvider("anthropic", apiKeys?.anthropic);
      const anthropicModels = anthropicProvider.modelList().map((m) => m.id);
      if (anthropicModels.includes(modelId)) {
        providerId = "anthropic";
      } else {
        const geminiProvider = createProvider("gemini", apiKeys?.gemini);
        const geminiModels = geminiProvider.modelList().map((m) => m.id);
        if (geminiModels.includes(modelId)) {
          providerId = "gemini";
        } else {
          throw new FatalError(
            `Cannot resolve provider for model: ${modelId}. Use a recognized model prefix or provide a fully-qualified ID.`
          );
        }
      }
    }
  }

  const apiKey = apiKeys?.[providerId];
  const provider = createProvider(providerId, apiKey);

  return { provider, model };
}

/**
 * Clear the provider cache (useful for testing).
 */
export function clearProviderCache(): void {
  providerCache.clear();
}

/**
 * Get all supported provider identifiers.
 */
export function getSupportedProviders(): ProviderId[] {
  return ["openai", "anthropic", "gemini"];
}
