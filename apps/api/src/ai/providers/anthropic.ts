// ============================================================================
// FlowMind AI — Anthropic Provider Adapter
// ============================================================================
// Adapter for Anthropic Claude models (Sonnet, Opus, Haiku).
// Uses the official @anthropic-ai/sdk.

import Anthropic from "@anthropic-ai/sdk";
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

const ANTHROPIC_MODELS: ModelInfo[] = [
  {
    id: "claude-3-5-sonnet-20241022",
    provider: "anthropic",
    maxContextTokens: 200_000,
    supportsVision: true,
    supportsToolCalling: true,
    supportsStreaming: true,
    costPerMillionInput: 3.0,
    costPerMillionOutput: 15.0,
  },
  {
    id: "claude-3-opus-20240229",
    provider: "anthropic",
    maxContextTokens: 200_000,
    supportsVision: true,
    supportsToolCalling: true,
    supportsStreaming: true,
    costPerMillionInput: 15.0,
    costPerMillionOutput: 75.0,
  },
  {
    id: "claude-3-haiku-20240307",
    provider: "anthropic",
    maxContextTokens: 200_000,
    supportsVision: true,
    supportsToolCalling: true,
    supportsStreaming: true,
    costPerMillionInput: 0.25,
    costPerMillionOutput: 1.25,
  },
];

/** Model aliases for convenience */
const MODEL_ALIASES: Record<string, string> = {
  "claude-3.5-sonnet": "claude-3-5-sonnet-20241022",
  "claude-3-5-sonnet": "claude-3-5-sonnet-20241022",
  "claude-3-opus": "claude-3-opus-20240229",
  "claude-3-haiku": "claude-3-haiku-20240307",
};

function resolveModel(model: string): string {
  return MODEL_ALIASES[model] || model;
}

function toAnthropicSystem(messages: ChatMessage[]): string | undefined {
  const systemMsgs = messages.filter((m) => m.role === "system");
  if (systemMsgs.length === 0) return undefined;
  return systemMsgs.map((m) => m.content ?? "").join("\n\n");
}

function toAnthropicMessages(
  messages: ChatMessage[],
): { role: "user" | "assistant"; content: Anthropic.ContentBlock[] }[] {
  const nonSystem = messages.filter((m) => m.role !== "system");
  const result: { role: "user" | "assistant"; content: Anthropic.ContentBlock[] }[] = [];

  for (const msg of nonSystem) {
    const blocks: Anthropic.ContentBlock[] = [];

    if (msg.content) {
      blocks.push({ type: "text", text: msg.content });
    }

    if (msg.toolCalls && msg.toolCalls.length > 0 && msg.role === "assistant") {
      for (const tc of msg.toolCalls) {
        blocks.push({
          type: "tool_use",
          id: tc.id,
          name: tc.function.name,
          input: JSON.parse(tc.function.arguments || "{}"),
        });
      }
    }

    if (msg.role === "tool" && msg.toolCallId) {
      blocks.push({
        type: "tool_result",
        tool_use_id: msg.toolCallId,
        content: msg.content ?? "",
      });
    }

    if (blocks.length === 0 && msg.content === null) {
      // Skip empty messages
      continue;
    }

    const role: "user" | "assistant" =
      msg.role === "assistant" ? "assistant" : "user";

    // Anthropic requires alternating user/assistant — merge consecutive same-role
    const last = result[result.length - 1];
    if (last && last.role === role) {
      last.content.push(...blocks);
    } else {
      result.push({ role, content: blocks });
    }
  }

  return result;
}

function toAnthropicTools(tools?: ToolDefinition[]): Anthropic.Tool[] | undefined {
  if (!tools || tools.length === 0) return undefined;
  return tools.map((t) => ({
    name: t.function.name,
    description: t.function.description,
    input_schema: t.function.parameters as Anthropic.Tool.InputSchema,
  }));
}

function mapFinishReason(reason: Anthropic.Message["stop_reason"]): FinishReason {
  switch (reason) {
    case "end_turn": return "stop";
    case "max_tokens": return "length";
    case "tool_use": return "tool_calls";
    case "stop_sequence": return "stop";
    default: return "error";
  }
}

function extractToolCalls(blocks: Anthropic.ContentBlock[]): ToolCall[] | undefined {
  const toolUses = blocks.filter((b) => b.type === "tool_use") as Anthropic.ToolUseBlock[];
  if (toolUses.length === 0) return undefined;

  return toolUses.map((tu) => ({
    id: tu.id,
    type: "function" as const,
    function: {
      name: tu.name,
      arguments: JSON.stringify(tu.input),
    },
  }));
}

function extractText(blocks: Anthropic.ContentBlock[]): string | null {
  const textBlocks = blocks.filter((b) => b.type === "text") as Anthropic.TextBlock[];
  return textBlocks.map((b) => b.text).join("") || null;
}

function extractUsage(usage: Anthropic.Usage): UsageStats {
  return {
    promptTokens: usage.input_tokens,
    completionTokens: usage.output_tokens,
    totalTokens: usage.input_tokens + usage.output_tokens,
  };
}

function mapAnthropicError(err: unknown): never {
  if (err instanceof Anthropic.APIError) {
    const status = err.status;
    if (status === 429) {
      throw new RetryableError(`Anthropic rate limited: ${err.message}`, err);
    }
    if (status === 401 || status === 403) {
      throw new FatalError(`Anthropic auth error: ${err.message}`, err);
    }
    if (status && status >= 500) {
      throw new RetryableError(`Anthropic server error (${status}): ${err.message}`, err);
    }
    if (status === 400 || status === 404) {
      throw new FatalError(`Anthropic request error: ${err.message}`, err);
    }
  }
  throw new RetryableError(
    err instanceof Error ? err.message : String(err),
    err instanceof Error ? err : undefined,
  );
}

export class AnthropicProvider implements LLMProvider {
  readonly provider = "anthropic";
  private client: Anthropic;

  constructor(apiKey?: string) {
    this.client = new Anthropic({
      apiKey: apiKey || process.env.ANTHROPIC_API_KEY || "missing-api-key",
    });
  }

  getClient(): Anthropic {
    return this.client;
  }

  supportsToolCalling(): boolean {
    return true;
  }

  supportsVision(): boolean {
    return true;
  }

  modelList(): ModelInfo[] {
    return ANTHROPIC_MODELS;
  }

  async chat(options: ChatOptions): Promise<ChatResponse> {
    const model = resolveModel(options.model);
    const system = toAnthropicSystem(options.messages);
    const messages = toAnthropicMessages(options.messages);
    const tools = toAnthropicTools(options.tools);

    try {
      const response = await this.client.messages.create({
        model,
        system: system || undefined,
        messages,
        tools,
        max_tokens: options.maxTokens ?? 4096,
        temperature: options.temperature,
        stop_sequences: options.stop,
      });

      const message: ChatMessage = {
        role: "assistant",
        content: extractText(response.content),
        toolCalls: extractToolCalls(response.content),
      };

      return {
        message,
        finishReason: mapFinishReason(response.stop_reason),
        usage: extractUsage(response.usage),
        model: response.model,
      };
    } catch (err) {
      return mapAnthropicError(err);
    }
  }

  async *streamChat(options: ChatOptions): AsyncIterable<ChatChunk> {
    const model = resolveModel(options.model);
    const system = toAnthropicSystem(options.messages);
    const messages = toAnthropicMessages(options.messages);
    const tools = toAnthropicTools(options.tools);

    try {
      const stream = await this.client.messages.stream({
        model,
        system: system || undefined,
        messages,
        tools,
        max_tokens: options.maxTokens ?? 4096,
        temperature: options.temperature,
        stop_sequences: options.stop,
      });

      for await (const event of stream) {
        if (event.type === "content_block_delta") {
          const delta = event.delta;
          if (delta.type === "text_delta") {
            yield { content: delta.text };
          } else if (delta.type === "input_json_delta") {
            // Tool argument streaming — yield partial
            yield { content: null };
          }
        } else if (event.type === "content_block_start") {
          const block = event.content_block;
          if (block.type === "tool_use") {
            yield {
              content: null,
              toolCalls: [{
                index: event.index,
                id: block.id,
                type: "function" as const,
                function: {
                  name: block.name,
                  arguments: JSON.stringify(block.input),
                },
              }],
            };
          }
        } else if (event.type === "message_stop") {
          // Stream ended
          break;
        }
      }

      // Get the final message for complete tool calls and finish reason
      const finalMessage = await stream.finalMessage();
      yield {
        content: null,
        finishReason: mapFinishReason(finalMessage.stop_reason),
      };
    } catch (err) {
      return mapAnthropicError(err);
    }
  }

  async embeddings(options: EmbeddingOptions): Promise<EmbeddingResponse> {
    // Anthropic does not have a native embeddings API.
    // This would typically fall back to another provider.
    throw new FatalError(
      "Anthropic does not support embeddings. Use OpenAI or Gemini instead."
    );
  }
}
