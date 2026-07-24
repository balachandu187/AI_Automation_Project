// ============================================================================
// FlowMind AI — Google Gemini Provider Adapter
// ============================================================================
// Adapter for Google Gemini models (2.0 Flash, 1.5 Pro, 1.5 Flash).
// Uses the official @google/generative-ai SDK.

import {
  GoogleGenerativeAI,
  type Content,
  type Part,
  type FunctionDeclaration,
  type Tool as GeminiTool,
} from "@google/generative-ai";
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

const GEMINI_MODELS: ModelInfo[] = [
  {
    id: "gemini-2.0-flash",
    provider: "gemini",
    maxContextTokens: 1_048_576,
    supportsVision: true,
    supportsToolCalling: true,
    supportsStreaming: true,
    costPerMillionInput: 0.1,
    costPerMillionOutput: 0.4,
  },
  {
    id: "gemini-1.5-pro",
    provider: "gemini",
    maxContextTokens: 2_097_152,
    supportsVision: true,
    supportsToolCalling: true,
    supportsStreaming: true,
    costPerMillionInput: 1.25,
    costPerMillionOutput: 5.0,
  },
  {
    id: "gemini-1.5-flash",
    provider: "gemini",
    maxContextTokens: 1_048_576,
    supportsVision: true,
    supportsToolCalling: true,
    supportsStreaming: true,
    costPerMillionInput: 0.075,
    costPerMillionOutput: 0.3,
  },
  {
    id: "text-embedding-004",
    provider: "gemini",
    maxContextTokens: 2_048,
    supportsVision: false,
    supportsToolCalling: false,
    supportsStreaming: false,
    costPerMillionInput: 0.0,
    costPerMillionOutput: 0,
  },
];

function toGeminiContents(messages: ChatMessage[]): { contents: Content[]; systemInstruction?: string } {
  const systemMsgs = messages.filter((m) => m.role === "system");
  const systemInstruction = systemMsgs.map((m) => m.content ?? "").join("\n\n") || undefined;

  const nonSystem = messages.filter((m) => m.role !== "system");
  const contents: Content[] = [];

  for (const msg of nonSystem) {
    const parts: Part[] = [];

    if (msg.content) {
      parts.push({ text: msg.content });
    }

    if (msg.toolCalls && msg.toolCalls.length > 0 && msg.role === "assistant") {
      for (const tc of msg.toolCalls) {
        parts.push({
          functionCall: {
            name: tc.function.name,
            args: JSON.parse(tc.function.arguments || "{}"),
          },
        });
      }
    }

    if (msg.role === "tool" && msg.toolCallId) {
      // Find the corresponding function call name from previous messages
      let funcName = "unknown";
      for (const prev of nonSystem) {
        if (prev.toolCalls) {
          const match = prev.toolCalls.find((tc) => tc.id === msg.toolCallId);
          if (match) {
            funcName = match.function.name;
            break;
          }
        }
      }
      parts.push({
        functionResponse: {
          name: funcName,
          response: { result: msg.content },
        },
      });
    }

    if (parts.length === 0) {
      parts.push({ text: "" });
    }

    const role: "user" | "model" =
      msg.role === "assistant" ? "model" : "user";

    // Merge consecutive same-role messages
    const last = contents[contents.length - 1];
    if (last && last.role === role) {
      last.parts.push(...parts);
    } else {
      contents.push({ role, parts });
    }
  }

  return { contents, systemInstruction };
}

function toGeminiTools(tools?: ToolDefinition[]): GeminiTool[] | undefined {
  if (!tools || tools.length === 0) return undefined;
  const functionDeclarations: FunctionDeclaration[] = tools.map((t) => ({
    name: t.function.name,
    description: t.function.description,
    parameters: t.function.parameters as Record<string, unknown>,
  }));
  return [{ functionDeclarations }];
}

function mapFinishReason(finishReason?: string): FinishReason {
  switch (finishReason) {
    case "STOP": return "stop";
    case "MAX_TOKENS": return "length";
    case "SAFETY": return "content_filter";
    case "RECITATION": return "content_filter";
    case "OTHER": return "error";
    default: return "stop";
  }
}

function extractToolCalls(parts: Part[]): ToolCall[] | undefined {
  const calls = parts.filter((p) => !!p.functionCall);
  if (calls.length === 0) return undefined;

  return calls.map((p, i) => ({
    id: `gemini-call-${i}`,
    type: "function" as const,
    function: {
      name: p.functionCall!.name ?? "unknown",
      arguments: JSON.stringify(p.functionCall!.args ?? {}),
    },
  }));
}

function extractText(parts: Part[]): string | null {
  return parts
    .filter((p) => p.text !== undefined)
    .map((p) => p.text ?? "")
    .join("") || null;
}

function extractUsage(metadata?: Record<string, unknown>): UsageStats {
  return {
    promptTokens: (metadata?.promptTokenCount as number) ?? 0,
    completionTokens: (metadata?.candidatesTokenCount as number) ?? 0,
    totalTokens: (metadata?.totalTokenCount as number) ?? 0,
  };
}

function mapGeminiError(err: unknown): never {
  const message = err instanceof Error ? err.message : String(err);
  const msgLower = message.toLowerCase();

  if (
    msgLower.includes("429") ||
    msgLower.includes("rate") ||
    msgLower.includes("quota")
  ) {
    throw new RetryableError(`Gemini rate limited: ${message}`, err instanceof Error ? err : undefined);
  }
  if (
    msgLower.includes("401") ||
    msgLower.includes("403") ||
    msgLower.includes("unauthorized") ||
    msgLower.includes("permission")
  ) {
    throw new FatalError(`Gemini auth error: ${message}`, err instanceof Error ? err : undefined);
  }
  if (msgLower.includes("500") || msgLower.includes("503") || msgLower.includes("internal")) {
    throw new RetryableError(`Gemini server error: ${message}`, err instanceof Error ? err : undefined);
  }
  if (msgLower.includes("400") || msgLower.includes("invalid") || msgLower.includes("not found")) {
    throw new FatalError(`Gemini request error: ${message}`, err instanceof Error ? err : undefined);
  }

  throw new RetryableError(message, err instanceof Error ? err : undefined);
}

export class GeminiProvider implements LLMProvider {
  readonly provider = "gemini";
  private client: GoogleGenerativeAI;

  constructor(apiKey?: string) {
    this.client = new GoogleGenerativeAI(
      apiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "missing-api-key",
    );
  }

  getClient(): GoogleGenerativeAI {
    return this.client;
  }

  supportsToolCalling(): boolean {
    return true;
  }

  supportsVision(): boolean {
    return true;
  }

  modelList(): ModelInfo[] {
    return GEMINI_MODELS;
  }

  async chat(options: ChatOptions): Promise<ChatResponse> {
    try {
      const model = this.client.getGenerativeModel({
        model: options.model,
        generationConfig: {
          temperature: options.temperature ?? 0.7,
          maxOutputTokens: options.maxTokens ?? 4096,
          stopSequences: options.stop,
        },
        tools: toGeminiTools(options.tools),
      });

      const { contents, systemInstruction } = toGeminiContents(options.messages);

      const result = await model.generateContent({
        contents,
        systemInstruction: systemInstruction
          ? { role: "user", parts: [{ text: systemInstruction }] }
          : undefined,
      });

      const response = result.response;
      const parts = response.candidates?.[0]?.content?.parts ?? [];

      const message: ChatMessage = {
        role: "assistant",
        content: extractText(parts),
        toolCalls: extractToolCalls(parts),
      };

      const finishReason = response.candidates?.[0]?.finishReason
        ? mapFinishReason(response.candidates[0].finishReason)
        : "stop";

      return {
        message,
        finishReason,
        usage: extractUsage(response.usageMetadata as unknown as Record<string, unknown>),
        model: options.model,
      };
    } catch (err) {
      return mapGeminiError(err);
    }
  }

  async *streamChat(options: ChatOptions): AsyncIterable<ChatChunk> {
    try {
      const model = this.client.getGenerativeModel({
        model: options.model,
        generationConfig: {
          temperature: options.temperature ?? 0.7,
          maxOutputTokens: options.maxTokens ?? 4096,
          stopSequences: options.stop,
        },
        tools: toGeminiTools(options.tools),
      });

      const { contents, systemInstruction } = toGeminiContents(options.messages);

      const stream = await model.generateContentStream({
        contents,
        systemInstruction: systemInstruction
          ? { role: "user", parts: [{ text: systemInstruction }] }
          : undefined,
      });

      for await (const chunk of stream) {
        const text = chunk.text();
        if (text) {
          yield { content: text };
        }

        const parts = chunk.candidates?.[0]?.content?.parts ?? [];
        const toolCalls = extractToolCalls(parts);
        if (toolCalls) {
          yield { content: null, toolCalls };
        }

        const finishReason = chunk.candidates?.[0]?.finishReason;
        if (finishReason) {
          yield {
            content: null,
            finishReason: mapFinishReason(finishReason),
          };
        }
      }
    } catch (err) {
      return mapGeminiError(err);
    }
  }

  async embeddings(options: EmbeddingOptions): Promise<EmbeddingResponse> {
    try {
      const model = this.client.getGenerativeModel({
        model: options.model || "text-embedding-004",
      });

      const inputs = Array.isArray(options.input) ? options.input : [options.input];
      const embeddings: number[][] = [];

      for (const text of inputs) {
        const result = await model.embedContent(text);
        embeddings.push(result.embedding.values);
      }

      return {
        embeddings,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        model: options.model || "text-embedding-004",
      };
    } catch (err) {
      return mapGeminiError(err);
    }
  }
}
