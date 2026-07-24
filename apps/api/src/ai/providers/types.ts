// ============================================================================
// FlowMind AI — Provider Adapter Shared Types
// ============================================================================
// Common interfaces for all LLM provider adapters (OpenAI, Anthropic, Gemini).
// Each adapter implements LLMProvider.

/** Role of a chat message participant */
export type ChatRole = "system" | "user" | "assistant" | "tool";

/** A single chat message */
export interface ChatMessage {
  role: ChatRole;
  content: string | null;
  /** Tool calls made by the assistant (only on assistant messages) */
  toolCalls?: ToolCall[];
  /** Tool call ID this message responds to (only on tool messages) */
  toolCallId?: string;
  /** Name of the tool being called (optional, on tool messages) */
  name?: string;
}

/** Definition of a tool/function the LLM can call */
export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

/** A tool call request from the LLM */
export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string; // JSON-encoded arguments
  };
}

/** Usage stats from an LLM response */
export interface UsageStats {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/** Why the LLM stopped generating */
export type FinishReason =
  | "stop"
  | "length"
  | "tool_calls"
  | "content_filter"
  | "error";

/** A complete chat response from the LLM */
export interface ChatResponse {
  message: ChatMessage;
  finishReason: FinishReason;
  usage: UsageStats;
  /** Which model actually served the request */
  model: string;
}

/** A streaming chunk from the LLM */
export interface ChatChunk {
  content: string | null;
  toolCalls?: Partial<ToolCall>[];
  finishReason?: FinishReason;
}

/** Options for a chat completion request */
export interface ChatOptions {
  model: string;
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  toolChoice?: "auto" | "none" | "required" | { type: "function"; function: { name: string } };
  temperature?: number;
  maxTokens?: number;
  /** System prompt (convenience — prepended as system message) */
  systemPrompt?: string;
  /** JSON mode / structured output */
  responseFormat?: { type: "json_object" } | { type: "text" };
  /** Stop sequences */
  stop?: string[];
  /** Abort signal for cancellation */
  signal?: AbortSignal;
}

/** Options for embeddings */
export interface EmbeddingOptions {
  model: string;
  input: string | string[];
}

/** An embedding vector */
export interface EmbeddingResponse {
  embeddings: number[][];
  usage: UsageStats;
  model: string;
}

/** Information about an available model */
export interface ModelInfo {
  id: string;
  provider: string;
  /** Max context window in tokens */
  maxContextTokens: number;
  /** Capabilities */
  supportsVision: boolean;
  supportsToolCalling: boolean;
  supportsStreaming: boolean;
  /** Approximate cost per 1M input tokens (USD) */
  costPerMillionInput: number;
  /** Approximate cost per 1M output tokens (USD) */
  costPerMillionOutput: number;
}

/**
 * The core LLMProvider interface.
 * Every provider adapter must implement this.
 */
export interface LLMProvider {
  /** Provider identifier (e.g., "openai", "anthropic", "gemini") */
  readonly provider: string;

  /** Send a chat completion request (non-streaming) */
  chat(options: ChatOptions): Promise<ChatResponse>;

  /** Send a streaming chat completion request */
  streamChat(options: ChatOptions): AsyncIterable<ChatChunk>;

  /** Generate embeddings for text(s) */
  embeddings(options: EmbeddingOptions): Promise<EmbeddingResponse>;

  /** Does this provider support native tool calling? */
  supportsToolCalling(): boolean;

  /** Does this provider support vision/image inputs? */
  supportsVision(): boolean;

  /** List available models from this provider */
  modelList(): ModelInfo[];
}
