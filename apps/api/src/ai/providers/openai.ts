// ============================================================================
// FlowMind AI — OpenAI Provider Adapter
// ============================================================================
// Adapter for OpenAI models (GPT-4o, GPT-4o-mini, GPT-4-turbo, etc.)
// Uses the official openai SDK.

import OpenAI from "openai";
import type {
  LLMProvider,
  ChatMessage,
  ChatOptions,
  ChatResponse,
  ChatChunk,
  EmbeddingOptions,
  EmbeddingResponse,
  ModelInfo,
  ToolDefinition,
  ToolCall,
  UsageStats,
  FinishReason,
} from "./types.js";
import { RetryableError, FatalError } from "../../engine/errors.js";

const OPENAI_MODELS: ModelInfo[] = [
  {
    id: "gpt-4o",
    provider: "openai",
    maxContextTokens: 128_000,
    supportsVision: true,
    supportsToolCalling: true,
    supportsStreaming: true,
    costPerMillionInput: 2.5,
    costPerMillionOutput: 10.0,
  },
  {
    id: "gpt-4o-mini",
    provider: "openai",
    maxContextTokens: 128_000,
    supportsVision: true,
    supportsToolCalling: true,
    supportsStreaming: true,
    costPerMillionInput: 0.15,
    costPerMillionOutput: 0.6,
  },
  {
    id: "gpt-4-turbo",
    provider: "openai",
    maxContextTokens: 128_000,
    supportsVision: true,
    supportsToolCalling: true,
    supportsStreaming: true,
    costPerMillionInput: 10.0,
    costPerMillionOutput: 30.0,
  },
  {
    id: "gpt-4",
    provider: "openai",
    maxContextTokens: 8_192,
    supportsVision: false,
    supportsToolCalling: true,
    supportsStreaming: true,
    costPerMillionInput: 30.0,
    costPerMillionOutput: 60.0,
  },
  {
    id: "gpt-3.5-turbo",
    provider: "openai",
    maxContextTokens: 16_385,
    supportsVision: false,
    supportsToolCalling: true,
    supportsStreaming: true,
    costPerMillionInput: 0.5,
    costPerMillionOutput: 1.5,
  },
  {
    id: "text-embedding-3-small",
    provider: "openai",
    maxContextTokens: 8_191,
    supportsVision: false,
    supportsToolCalling: false,
    supportsStreaming: false,
    costPerMillionInput: 0.02,
    costPerMillionOutput: 0,
  },
  {
    id: "text-embedding-3-large",
    provider: "openai",
    maxContextTokens: 8_191,
    supportsVision: false,
    supportsToolCalling: false,
    supportsStreaming: false,
    costPerMillionInput: 0.13,
    costPerMillionOutput: 0,
  },
];

function toOpenAIMessages(messages: ChatMessage[]): OpenAI.ChatCompletionMessageParam[] {
  return messages.map((msg) => {
    const base: Record<string, unknown> = {};
    if (msg.content !== null) base.content = msg.content;

    switch (msg.role) {
      case "system":
        return { role: "system", content: msg.content ?? "" } as OpenAI.ChatCompletionSystemMessageParam;
      case "user":
        return { role: "user", content: msg.content ?? "" } as OpenAI.ChatCompletionUserMessageParam;
      case "assistant": {
        const result: OpenAI.ChatCompletionAssistantMessageParam = {
          role: "assistant",
          content: msg.content ?? null,
        };
        if (msg.toolCalls && msg.toolCalls.length > 0) {
          result.tool_calls = msg.toolCalls.map((tc) => ({
            id: tc.id,
            type: "function" as const,
            function: {
              name: tc.function.name,
              arguments: tc.function.arguments,
            },
          }));
        }
        return result;
      }
      case "tool":
        return {
          role: "tool",
          tool_call_id: msg.toolCallId ?? "",
          content: msg.content ?? "",
        } as OpenAI.ChatCompletionToolMessageParam;
      default:
        return { role: "user", content: msg.content ?? "" } as OpenAI.ChatCompletionUserMessageParam;
    }
  });
}

function toOpenAITools(tools?: ToolDefinition[]): OpenAI.ChatCompletionTool[] | undefined {
  if (!tools || tools.length === 0) return undefined;
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.function.name,
      description: t.function.description,
      parameters: t.function.parameters as Record<string, unknown>,
    },
  }));
}

function mapFinishReason(reason: string | null): FinishReason {
  switch (reason) {
    case "stop": return "stop";
    case "length": return "length";
    case "tool_calls": return "tool_calls";
    case "content_filter": return "content_filter";
    default: return "error";
  }
}

function mapToolCalls(toolCalls?: OpenAI.ChatCompletionMessageToolCall[]): ToolCall[] | undefined {
  if (!toolCalls || toolCalls.length === 0) return undefined;
  return toolCalls.map((tc) => ({
    id: tc.id,
    type: "function" as const,
    function: {
      name: tc.function.name,
      arguments: tc.function.arguments,
    },
  }));
}

function extractUsage(usage?: OpenAI.CompletionUsage): UsageStats {
  return {
    promptTokens: usage?.prompt_tokens ?? 0,
    completionTokens: usage?.completion_tokens ?? 0,
    totalTokens: usage?.total_tokens ?? 0,
  };
}

function mapOpenAIError(err: unknown): never {
  if (err instanceof OpenAI.APIError) {
    const status = err.status;
    // Rate limit → retryable
    if (status === 429) {
      throw new RetryableError(`OpenAI rate limited: ${err.message}`, err);
    }
    // Auth errors → fatal
    if (status === 401 || status === 403) {
      throw new FatalError(`OpenAI auth error: ${err.message}`, err);
    }
    // Server errors → retryable
    if (status && status >= 500) {
      throw new RetryableError(`OpenAI server error (${status}): ${err.message}`, err);
    }
    // Other client errors → fatal
    if (status === 400 || status === 404) {
      throw new FatalError(`OpenAI request error: ${err.message}`, err);
    }
  }
  // Unknown errors → retryable (network, timeout, etc.)
  throw new RetryableError(
    err instanceof Error ? err.message : String(err),
    err instanceof Error ? err : undefined,
  );
}

export class OpenAIProvider implements LLMProvider {
  readonly provider = "openai";
  private client: OpenAI;

  constructor(apiKey?: string) {
    this.client = new OpenAI({
      apiKey: apiKey || process.env.OPENAI_API_KEY || "missing-api-key",
    });
  }

  getClient(): OpenAI {
    return this.client;
  }

  supportsToolCalling(): boolean {
    return true;
  }

  supportsVision(): boolean {
    return true;
  }

  modelList(): ModelInfo[] {
    return OPENAI_MODELS;
  }

  async chat(options: ChatOptions): Promise<ChatResponse> {
    const messages = toOpenAIMessages(options.messages);
    const tools = toOpenAITools(options.tools);

    try {
      const response = await this.client.chat.completions.create({
        model: options.model,
        messages,
        tools,
        tool_choice: options.toolChoice as OpenAI.ChatCompletionToolChoiceOption | undefined,
        temperature: options.temperature ?? 0.7,
        max_tokens: options.maxTokens,
        response_format: options.responseFormat as OpenAI.ChatCompletionCreateParams["response_format"] | undefined,
        stop: options.stop,
      });

      const choice = response.choices[0];
      if (!choice) {
        throw new FatalError("OpenAI returned no choices");
      }

      const message: ChatMessage = {
        role: "assistant",
        content: choice.message.content,
        toolCalls: mapToolCalls(choice.message.tool_calls),
      };

      return {
        message,
        finishReason: mapFinishReason(choice.finish_reason),
        usage: extractUsage(response.usage),
        model: response.model,
      };
    } catch (err) {
      return mapOpenAIError(err);
    }
  }

  async *streamChat(options: ChatOptions): AsyncIterable<ChatChunk> {
    const messages = toOpenAIMessages(options.messages);
    const tools = toOpenAITools(options.tools);

    try {
      const stream = await this.client.chat.completions.create({
        model: options.model,
        messages,
        tools,
        tool_choice: options.toolChoice as OpenAI.ChatCompletionToolChoiceOption | undefined,
        temperature: options.temperature ?? 0.7,
        max_tokens: options.maxTokens,
        response_format: options.responseFormat as OpenAI.ChatCompletionCreateParams["response_format"] | undefined,
        stop: options.stop,
        stream: true,
      });

      const accumulatedToolCalls: Map<number, { id: string; name: string; arguments: string }> = new Map();

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta;
        if (!delta) continue;

        const chatChunk: ChatChunk = {
          content: delta.content ?? null,
          finishReason: chunk.choices[0]?.finish_reason
            ? mapFinishReason(chunk.choices[0].finish_reason)
            : undefined,
        };

        // Accumulate tool calls across streaming chunks
        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index;
            const existing = accumulatedToolCalls.get(idx) || { id: "", name: "", arguments: "" };
            if (tc.id) existing.id = tc.id;
            if (tc.function?.name) existing.name += tc.function.name;
            if (tc.function?.arguments) existing.arguments += tc.function.arguments;
            accumulatedToolCalls.set(idx, existing);
          }

          chatChunk.toolCalls = Array.from(accumulatedToolCalls.values()).map((tc, i) => ({
            index: i,
            id: tc.id,
            type: "function" as const,
            function: {
              name: tc.name,
              arguments: tc.arguments,
            },
          }));
        }

        yield chatChunk;
      }
    } catch (err) {
      return mapOpenAIError(err);
    }
  }

  async embeddings(options: EmbeddingOptions): Promise<EmbeddingResponse> {
    const inputs = Array.isArray(options.input) ? options.input : [options.input];

    try {
      const response = await this.client.embeddings.create({
        model: options.model,
        input: inputs,
      });

      const embeddings = response.data
        .sort((a, b) => a.index - b.index)
        .map((item) => item.embedding);

      return {
        embeddings,
        usage: extractUsage(response.usage),
        model: response.model,
      };
    } catch (err) {
      return mapOpenAIError(err);
    }
  }
}
