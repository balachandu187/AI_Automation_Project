// ============================================================================
// FlowMind AI Orchestration Layer — Barrel Export
// ============================================================================
// The AI Orchestrator is the central module for all AI capabilities.

// Providers
export type {
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
  ChatRole,
  ProviderConfig,
  ProviderId,
} from "./providers/index.js";

export {
  OpenAIProvider,
  AnthropicProvider,
  GeminiProvider,
  createProvider,
  resolveModelProvider,
  clearProviderCache,
  getSupportedProviders,
} from "./providers/index.js";

// Router
export {
  ModelRouter,
  UsageTracker,
  DEFAULT_ROUTING_POLICY,
} from "./router.js";
export type {
  TaskType,
  RoutingPolicy,
  RoutingResult,
  UsageRecord,
} from "./router.js";

// Prompts
export {
  PromptManager,
  createPromptManager,
  testPrompt,
  BUILTIN_PROMPTS,
} from "./prompts.js";
export type {
  PromptTemplate,
  PromptVariable,
  PromptVersion,
  PromptTestResult,
} from "./prompts.js";

// Tools
export {
  ToolRegistry,
  createDefaultToolRegistry,
  createHttpRequestTool,
  createSlackTool,
  createEmailTool,
  createWebhookTool,
  createDatabaseQueryTool,
  createHumanEscalationTool,
} from "./tools.js";
export type {
  RegisteredTool,
  ToolExecutionContext,
  ToolResult,
  ToolParamDef,
} from "./tools.js";

// Agent Loop
export { AgentExecutor } from "./agent-loop.js";
export type {
  AgentConfig,
  AgentState,
  AgentResult,
  ApprovalGate,
  ApprovalRequest,
} from "./agent-loop.js";

// RAG
export {
  RAGEngine,
  InMemoryVectorStore,
  chunkDocument,
  generateEmbeddings,
  cosineSimilarity,
  buildRAGPrompt,
  estimateTokenCount,
  DEFAULT_RAG_CONFIG,
} from "./rag.js";
export type {
  RAGConfig,
  DocumentChunk,
  ScoredChunk,
  RAGResult,
  VectorStore,
} from "./rag.js";

// Memory
export {
  ConversationMemory,
  WorkingMemory,
  LongTermMemoryStore,
  MemoryManager,
  DEFAULT_MEMORY_CONFIG,
} from "./memory.js";
export type {
  MemoryConfig,
  LongTermMemory,
} from "./memory.js";

// Confidence
export {
  ConfidenceScorer,
  createConfidenceScorer,
  COMMON_BUSINESS_RULES,
  DEFAULT_CONFIDENCE_CONFIG,
} from "./confidence.js";
export type {
  ConfidenceConfig,
  ConfidenceResult,
  ConfidenceFactors,
  ValidationRule,
} from "./confidence.js";

// ============================================================================
// AI Orchestrator — High-Level Facade
// ============================================================================

import type { LLMProvider } from "./providers/types.js";
import { resolveModelProvider } from "./providers/adapter-factory.js";
import type { ProviderId } from "./providers/adapter-factory.js";
import { ModelRouter, type RoutingPolicy, type TaskType } from "./router.js";
import { PromptManager } from "./prompts.js";
import { ToolRegistry } from "./tools.js";
import { AgentExecutor, type AgentConfig, type AgentResult } from "./agent-loop.js";
import { RAGEngine, InMemoryVectorStore, type RAGConfig, type RAGResult } from "./rag.js";

export interface OrchestratorConfig {
  apiKeys?: Partial<Record<ProviderId, string>>;
  routingPolicy?: Partial<RoutingPolicy>;
  defaultModel?: string;
}

/**
 * High-level AI Orchestrator that combines all AI capabilities.
 * This is the main entry point for AI operations in FlowMind.
 */
export class AIOrchestrator {
  readonly prompts: PromptManager;
  readonly tools: ToolRegistry;
  readonly router: ModelRouter;
  readonly rag: RAGEngine;

  private config: OrchestratorConfig;

  constructor(config: OrchestratorConfig = {}) {
    this.config = config;
    this.prompts = new PromptManager();
    this.tools = new ToolRegistry();
    this.router = new ModelRouter(config.routingPolicy, config.apiKeys);
    this.rag = new RAGEngine(new InMemoryVectorStore(), {}, config.apiKeys);
  }

  /**
   * Simple LLM call (single prompt → response).
   */
  async complete(
    prompt: string,
    options: {
      model?: string;
      systemPrompt?: string;
      temperature?: number;
      maxTokens?: number;
      taskType?: TaskType;
    } = {},
  ): Promise<{ content: string; usage: { promptTokens: number; completionTokens: number }; model: string }> {
    const model = options.model || this.config.defaultModel || "gpt-4o-mini";
    const { provider } = resolveModelProvider(model, this.config.apiKeys);

    const result = await this.router.chat({
      model,
      messages: [
        ...(options.systemPrompt ? [{ role: "system" as const, content: options.systemPrompt }] : []),
        { role: "user" as const, content: prompt },
      ],
      temperature: options.temperature,
      maxTokens: options.maxTokens,
      taskType: options.taskType,
    });

    return {
      content: result.response.message.content || "",
      usage: {
        promptTokens: result.response.usage.promptTokens,
        completionTokens: result.response.usage.completionTokens,
      },
      model: result.modelUsed,
    };
  }

  /**
   * Run an autonomous agent task.
   */
  async runAgent(
    task: string,
    config?: Partial<AgentConfig>,
  ): Promise<AgentResult> {
    const agent = new AgentExecutor(this.tools, {
      ...config,
      apiKeys: this.config.apiKeys,
      routingPolicy: this.config.routingPolicy,
    });

    return agent.run(task);
  }

  /**
   * Query the RAG system.
   */
  async queryRAG(
    query: string,
    ragConfig?: Partial<RAGConfig>,
  ): Promise<RAGResult> {
    const engine = ragConfig
      ? new RAGEngine(new InMemoryVectorStore(), ragConfig, this.config.apiKeys)
      : this.rag;

    const result = await engine.query(query);

    // If we have context, use it with LLM to generate answer
    if (result.promptUsed) {
      const model = this.config.defaultModel || "gpt-4o-mini";
      const { provider } = resolveModelProvider(model, this.config.apiKeys);

      const chatResult = await provider.chat({
        model,
        messages: [{ role: "user", content: result.promptUsed }],
      });

      result.answers = chatResult.message.content || "Unable to generate answer.";
      result.usage = {
        promptTokens: chatResult.usage.promptTokens,
        completionTokens: chatResult.usage.completionTokens,
      };
    }

    return result;
  }

  /**
   * Index documents into the RAG system.
   */
  async indexDocuments(
    documents: { id: string; content: string; metadata?: Record<string, unknown> }[],
  ): Promise<{ totalChunks: number }> {
    return this.rag.indexDocuments(documents);
  }
}

/**
 * Create a fully configured AI Orchestrator.
 */
export function createOrchestrator(config?: OrchestratorConfig): AIOrchestrator {
  return new AIOrchestrator(config);
}
