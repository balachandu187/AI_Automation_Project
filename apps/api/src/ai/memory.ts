// ============================================================================
// FlowMind AI — Memory System
// ============================================================================
// Three-tier memory for AI agents:
//   Short-term: conversation history (in-memory ChatMessage[])
//   Working: key-value store per execution (variables, intermediate results)
//   Long-term: vector embeddings of past conversations for retrieval

import type { ChatMessage } from "./providers/types.js";
import { FatalError } from "../engine/errors.js";

// ============================================================================
// Types
// ============================================================================

export interface MemoryConfig {
  /** Maximum messages to keep in short-term memory (default: 50) */
  maxMessages: number;
  /** Maximum tokens in conversation (approximate, default: 100000) */
  maxContextTokens: number;
  /** Whether to prune old messages to stay within token limit */
  enablePruning: boolean;
  /** How many latest messages to always keep (never pruned) */
  preserveLastN: number;
}

export const DEFAULT_MEMORY_CONFIG: MemoryConfig = {
  maxMessages: 50,
  maxContextTokens: 100_000,
  enablePruning: true,
  preserveLastN: 5,
};

/** A long-term memory entry */
export interface LongTermMemory {
  id: string;
  /** The memory content */
  content: string;
  /** Embedding vector for semantic search */
  embedding?: number[];
  /** Metadata */
  metadata: Record<string, unknown>;
  /** Importance score (0-1) */
  importance: number;
  /** When this was created */
  createdAt: Date;
  /** When this was last accessed */
  lastAccessedAt: Date;
  /** TTL in seconds (null = never expires) */
  ttlSeconds: number | null;
}

// ============================================================================
// Short-Term Memory (Conversation History)
// ============================================================================

export class ConversationMemory {
  private messages: ChatMessage[] = [];
  private config: MemoryConfig;

  constructor(config: Partial<MemoryConfig> = {}) {
    this.config = { ...DEFAULT_MEMORY_CONFIG, ...config };
  }

  /**
   * Add a message to the conversation.
   */
  add(message: ChatMessage): void {
    this.messages.push(message);
    if (this.config.enablePruning) {
      this.prune();
    }
  }

  /**
   * Add a system message.
   */
  addSystemMessage(content: string): void {
    this.add({ role: "system", content });
  }

  /**
   * Add a user message.
   */
  addUserMessage(content: string): void {
    this.add({ role: "user", content });
  }

  /**
   * Add an assistant message (optionally with tool calls).
   */
  addAssistantMessage(
    content: string | null,
    toolCalls?: ChatMessage["toolCalls"],
  ): void {
    this.add({ role: "assistant", content, toolCalls });
  }

  /**
   * Add a tool result message.
   */
  addToolResult(toolCallId: string, result: string): void {
    this.add({
      role: "tool",
      content: result,
      toolCallId,
    });
  }

  /**
   * Get all messages.
   */
  getMessages(): ChatMessage[] {
    return [...this.messages];
  }

  /**
   * Get the last N messages.
   */
  getRecent(n: number): ChatMessage[] {
    return this.messages.slice(-n);
  }

  /**
   * Get the last assistant message.
   */
  getLastAssistantMessage(): string | null {
    const last = [...this.messages]
      .reverse()
      .find((m) => m.role === "assistant");
    return last?.content ?? null;
  }

  /**
   * Get all tool calls made during this conversation.
   */
  getToolCalls(): { name: string; args: unknown }[] {
    const calls: { name: string; args: unknown }[] = [];
    for (const msg of this.messages) {
      if (msg.role === "assistant" && msg.toolCalls) {
        for (const tc of msg.toolCalls) {
          let args: unknown = {};
          try {
            args = JSON.parse(tc.function.arguments || "{}");
          } catch { /* ignored */ }
          calls.push({ name: tc.function.name, args });
        }
      }
    }
    return calls;
  }

  /**
   * Estimate total tokens in the conversation.
   */
  estimateTotalTokens(): number {
    let total = 0;
    for (const msg of this.messages) {
      if (msg.content) {
        total += Math.ceil(msg.content.length / 4);
      }
      if (msg.toolCalls) {
        for (const tc of msg.toolCalls) {
          total += Math.ceil(tc.function.arguments.length / 4) + 10;
        }
      }
    }
    return total;
  }

  /**
   * Prune old messages to stay within limits.
   * Always preserves system messages and the last `preserveLastN` messages.
   */
  private prune(): void {
    // Remove excess messages
    while (this.messages.length > this.config.maxMessages) {
      // Find first non-system message to remove
      const idx = this.messages.findIndex(
        (m, i) =>
          m.role !== "system" &&
          i < this.messages.length - this.config.preserveLastN,
      );
      if (idx === -1) break;
      this.messages.splice(idx, 1);
    }

    // Remove excess tokens (but keep preserveLastN + system)
    while (
      this.config.enablePruning &&
      this.estimateTotalTokens() > this.config.maxContextTokens &&
      this.messages.length > this.config.preserveLastN
    ) {
      const idx = this.messages.findIndex(
        (m, i) =>
          m.role !== "system" &&
          i < this.messages.length - this.config.preserveLastN,
      );
      if (idx === -1) break;
      this.messages.splice(idx, 1);
    }
  }

  /**
   * Clear all messages.
   */
  clear(): void {
    this.messages = [];
  }

  /**
   * Get the number of messages.
   */
  get length(): number {
    return this.messages.length;
  }
}

// ============================================================================
// Working Memory (Key-Value Store)
// ============================================================================

export class WorkingMemory {
  private store = new Map<string, unknown>();

  /**
   * Set a value in working memory.
   */
  set(key: string, value: unknown): void {
    this.store.set(key, value);
  }

  /**
   * Get a value from working memory.
   */
  get<T = unknown>(key: string): T | undefined {
    return this.store.get(key) as T | undefined;
  }

  /**
   * Get a value with a default.
   */
  getWithDefault<T>(key: string, defaultValue: T): T {
    const value = this.store.get(key);
    return value !== undefined ? (value as T) : defaultValue;
  }

  /**
   * Check if a key exists.
   */
  has(key: string): boolean {
    return this.store.has(key);
  }

  /**
   * Delete a key.
   */
  delete(key: string): boolean {
    return this.store.delete(key);
  }

  /**
   * Get all keys.
   */
  keys(): string[] {
    return Array.from(this.store.keys());
  }

  /**
   * Get all entries.
   */
  entries(): [string, unknown][] {
    return Array.from(this.store.entries());
  }

  /**
   * Export all values as a plain object.
   */
  toObject(): Record<string, unknown> {
    return Object.fromEntries(this.store);
  }

  /**
   * Import values from an object.
   */
  fromObject(obj: Record<string, unknown>): void {
    for (const [key, value] of Object.entries(obj)) {
      this.set(key, value);
    }
  }

  /**
   * Clear all working memory.
   */
  clear(): void {
    this.store.clear();
  }
}

// ============================================================================
// Long-Term Memory
// ============================================================================

export class LongTermMemoryStore {
  private memories: LongTermMemory[] = [];
  private vectorStore: { search: (vector: number[], opts: { topK: number; threshold?: number }) => Promise<{ id: string; score: number }[]> } | null = null;

  constructor(vectorStore?: { search: (vector: number[], opts: { topK: number; threshold?: number }) => Promise<{ id: string; score: number }[]> }) {
    this.vectorStore = vectorStore || null;
  }

  /**
   * Store a long-term memory.
   */
  async store(
    content: string,
    options: {
      embedding?: number[];
      metadata?: Record<string, unknown>;
      importance?: number;
      ttlSeconds?: number | null;
    } = {},
  ): Promise<string> {
    const id = `mem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const memory: LongTermMemory = {
      id,
      content,
      embedding: options.embedding,
      metadata: options.metadata || {},
      importance: options.importance ?? 0.5,
      createdAt: new Date(),
      lastAccessedAt: new Date(),
      ttlSeconds: options.ttlSeconds ?? null,
    };

    this.memories.push(memory);

    // Prune expired memories
    this.pruneExpired();

    return id;
  }

  /**
   * Retrieve memories by semantic similarity (requires embeddings).
   * If no vector store is configured, falls back to keyword search.
   */
  async retrieve(
    query: string,
    options: {
      topK?: number;
      threshold?: number;
      minImportance?: number;
    } = {},
  ): Promise<LongTermMemory[]> {
    const topK = options.topK ?? 5;
    const minImportance = options.minImportance ?? 0;

    // Prune expired first
    this.pruneExpired();

    // If we have a vector store, use semantic search
    if (this.vectorStore) {
      // Generate query embedding would happen here
      // For now, fall back to keyword search
    }

    // Keyword fallback
    const queryLower = query.toLowerCase();
    const words = queryLower.split(/\s+/).filter((w) => w.length > 2);

    const scored = this.memories
      .filter((m) => m.importance >= minImportance)
      .map((m) => {
        const contentLower = m.content.toLowerCase();
        let score = 0;
        for (const word of words) {
          if (contentLower.includes(word)) score += 1;
        }
        // Normalize by content length to avoid bias toward long entries
        score = score / Math.max(1, m.content.length / 100);
        return { memory: m, score };
      })
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);

    // Update last accessed
    for (const { memory } of scored) {
      memory.lastAccessedAt = new Date();
    }

    return scored.map((s) => s.memory);
  }

  /**
   * Delete a memory by ID.
   */
  delete(id: string): boolean {
    const idx = this.memories.findIndex((m) => m.id === id);
    if (idx === -1) return false;
    this.memories.splice(idx, 1);
    return true;
  }

  /**
   * Prune expired memories (those past their TTL).
   */
  private pruneExpired(): void {
    const now = Date.now();
    this.memories = this.memories.filter((m) => {
      if (m.ttlSeconds === null) return true;
      const expiresAt = m.createdAt.getTime() + m.ttlSeconds * 1000;
      return now < expiresAt;
    });
  }

  /**
   * Get all memories (for debugging).
   */
  getAll(): LongTermMemory[] {
    this.pruneExpired();
    return [...this.memories];
  }

  /**
   * Clear all memories.
   */
  clear(): void {
    this.memories = [];
  }
}

// ============================================================================
// Unified Memory Manager
// ============================================================================

export class MemoryManager {
  readonly conversation: ConversationMemory;
  readonly working: WorkingMemory;
  readonly longTerm: LongTermMemoryStore;

  constructor(
    config: {
      conversation?: Partial<MemoryConfig>;
      vectorStore?: { search: (vector: number[], opts: { topK: number; threshold?: number }) => Promise<{ id: string; score: number }[]> };
    } = {},
  ) {
    this.conversation = new ConversationMemory(config.conversation);
    this.working = new WorkingMemory();
    this.longTerm = new LongTermMemoryStore(config.vectorStore);
  }

  /**
   * Clear all memory stores.
   */
  clearAll(): void {
    this.conversation.clear();
    this.working.clear();
    this.longTerm.clear();
  }
}
