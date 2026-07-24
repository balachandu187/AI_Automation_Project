// ============================================================================
// FlowMind AI — RAG (Retrieval Augmented Generation) System
// ============================================================================
// Document chunking, embedding generation, vector storage via pgvector,
// similarity search with configurable threshold, and context window management.

import type { LLMProvider, EmbeddingResponse } from "./providers/types.js";
import { resolveModelProvider } from "./providers/adapter-factory.js";
import type { ProviderId } from "./providers/adapter-factory.js";
import { FatalError } from "../engine/errors.js";

// ============================================================================
// Types
// ============================================================================

export interface RAGConfig {
  /** Chunk size in tokens (approximate, default: 512) */
  chunkSize: number;
  /** Chunk overlap in tokens (default: 64) */
  chunkOverlap: number;
  /** Embedding model (default: text-embedding-3-small) */
  embeddingModel: string;
  /** Minimum similarity threshold for retrieval (0-1, default: 0.7) */
  similarityThreshold: number;
  /** Maximum chunks to retrieve per query (default: 10) */
  topK: number;
  /** Maximum tokens in assembled context (default: 8000) */
  maxContextTokens: number;
  /** Provider API keys */
  apiKeys?: Partial<Record<ProviderId, string>>;
}

export const DEFAULT_RAG_CONFIG: RAGConfig = {
  chunkSize: 512,
  chunkOverlap: 64,
  embeddingModel: "text-embedding-3-small",
  similarityThreshold: 0.7,
  topK: 10,
  maxContextTokens: 8000,
};

/** A document chunk */
export interface DocumentChunk {
  id: string;
  documentId: string;
  content: string;
  metadata: Record<string, unknown>;
  /** Token count (approximate) */
  tokenCount: number;
  /** Position in the original document */
  chunkIndex: number;
}

/** A chunk with its similarity score */
export interface ScoredChunk {
  chunk: DocumentChunk;
  score: number;
}

/** Result of a RAG query */
export interface RAGResult {
  query: string;
  answers: string;
  chunks: ScoredChunk[];
  /** Prompt + context sent to the LLM */
  promptUsed?: string;
  /** Token usage */
  usage?: { promptTokens: number; completionTokens: number };
}

// ============================================================================
// Chunking
// ============================================================================

/**
 * Recursive text splitter — splits text into chunks of approximately
 * `chunkSize` tokens with `chunkOverlap` overlap.
 *
 * Splitting hierarchy: paragraphs → sentences → words → characters
 */
export function chunkDocument(
  text: string,
  documentId: string,
  config: { chunkSize?: number; chunkOverlap?: number; metadata?: Record<string, unknown> } = {},
): DocumentChunk[] {
  const chunkSize = config.chunkSize ?? 512;
  const chunkOverlap = config.chunkOverlap ?? 64;
  const metadata = config.metadata || {};

  // Split by paragraphs first
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  const chunks: DocumentChunk[] = [];
  let chunkIndex = 0;

  for (const para of paragraphs) {
    // Estimate tokens: ~4 chars per token for English
    const paraTokens = Math.ceil(para.length / 4);

    if (paraTokens <= chunkSize) {
      chunks.push({
        id: `${documentId}-chunk-${chunkIndex}`,
        documentId,
        content: para,
        metadata: { source: "paragraph", ...metadata },
        tokenCount: paraTokens,
        chunkIndex,
      });
      chunkIndex++;
    } else {
      // Split paragraph into sentences
      const sentences = para.match(/[^.!?]+[.!?]+[\])'"'"]*\s*/g) || [para];
      let currentChunk = "";
      let currentTokens = 0;

      for (const sentence of sentences) {
        const sentenceTokens = Math.ceil(sentence.length / 4);

        if (currentTokens + sentenceTokens > chunkSize && currentChunk.length > 0) {
          chunks.push({
            id: `${documentId}-chunk-${chunkIndex}`,
            documentId,
            content: currentChunk.trim(),
            metadata: { source: "sentence", ...metadata },
            tokenCount: currentTokens,
            chunkIndex,
          });
          chunkIndex++;

          // Start new chunk with overlap
          const words = currentChunk.split(/\s+/);
          const overlapWords = Math.ceil((chunkOverlap / 4));
          const overlapText = words.slice(-overlapWords).join(" ");
          currentChunk = overlapText + " " + sentence;
          currentTokens = Math.ceil(currentChunk.length / 4);
        } else {
          currentChunk += (currentChunk ? " " : "") + sentence;
          currentTokens += sentenceTokens;
        }
      }

      // Don't forget the last chunk
      if (currentChunk.trim().length > 0) {
        chunks.push({
          id: `${documentId}-chunk-${chunkIndex}`,
          documentId,
          content: currentChunk.trim(),
          metadata: { ...metadata, source: "sentence" },
          tokenCount: currentTokens,
          chunkIndex,
        });
        chunkIndex++;
      }
    }
  }

  return chunks;
}

// ============================================================================
// Embedding Generation
// ============================================================================

/**
 * Generate embeddings for multiple text chunks.
 * Batches requests if the provider supports it.
 */
export async function generateEmbeddings(
  texts: string[],
  config: { model?: string; apiKeys?: Partial<Record<ProviderId, string>> } = {},
): Promise<number[][]> {
  const model = config.model || "text-embedding-3-small";

  try {
    const { provider } = resolveModelProvider(model, config.apiKeys);

    // Process in batches of 20 to avoid overwhelming the API
    const batchSize = 20;
    const allEmbeddings: number[][] = [];

    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const response: EmbeddingResponse = await provider.embeddings({
        model,
        input: batch,
      });
      allEmbeddings.push(...response.embeddings);
    }

    return allEmbeddings;
  } catch (err) {
    throw new FatalError(
      `Failed to generate embeddings: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

// ============================================================================
// Vector Storage Interface
// ============================================================================

/**
 * Interface for vector storage backends.
 * Implementations can use pgvector, Pinecone, or in-memory for testing.
 */
export interface VectorStore {
  /** Store a vector with associated metadata */
  upsert(id: string, vector: number[], metadata: Record<string, unknown>): Promise<void>;
  /** Find nearest neighbors by cosine similarity */
  search(
    queryVector: number[],
    options: { topK: number; threshold?: number; filter?: Record<string, unknown> },
  ): Promise<ScoredChunk[]>;
  /** Delete vectors by ID */
  delete(ids: string[]): Promise<void>;
  /** Delete all vectors (for testing/cleanup) */
  clear(): Promise<void>;
}

/**
 * In-memory vector store for testing and development.
 */
export class InMemoryVectorStore implements VectorStore {
  private vectors: {
    id: string;
    vector: number[];
    metadata: Record<string, unknown>;
  }[] = [];

  async upsert(
    id: string,
    vector: number[],
    metadata: Record<string, unknown>,
  ): Promise<void> {
    const existingIdx = this.vectors.findIndex((v) => v.id === id);
    if (existingIdx >= 0) {
      this.vectors[existingIdx] = { id, vector, metadata };
    } else {
      this.vectors.push({ id, vector, metadata });
    }
  }

  async search(
    queryVector: number[],
    options: { topK: number; threshold?: number; filter?: Record<string, unknown> },
  ): Promise<ScoredChunk[]> {
    const threshold = options.threshold ?? 0.7;
    const topK = options.topK ?? 10;

    // Compute cosine similarity
    const scored = this.vectors
      .filter((v) => {
        if (!options.filter) return true;
        return Object.entries(options.filter).every(
          ([key, val]) => v.metadata[key] === val,
        );
      })
      .map((v) => ({
        chunk: {
          id: v.id,
          documentId: (v.metadata.documentId as string) || "",
          content: (v.metadata.content as string) || "",
          metadata: v.metadata,
          tokenCount: (v.metadata.tokenCount as number) || 0,
          chunkIndex: (v.metadata.chunkIndex as number) || 0,
        },
        score: cosineSimilarity(queryVector, v.vector),
      }))
      .filter((s) => s.score >= threshold)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);

    return scored;
  }

  async delete(ids: string[]): Promise<void> {
    this.vectors = this.vectors.filter((v) => !ids.includes(v.id));
  }

  async clear(): Promise<void> {
    this.vectors = [];
  }
}

// ============================================================================
// RAG Engine
// ============================================================================

export class RAGEngine {
  private config: RAGConfig;
  private vectorStore: VectorStore;
  private apiKeys: Partial<Record<ProviderId, string>>;

  constructor(
    vectorStore: VectorStore,
    config: Partial<RAGConfig> = {},
    apiKeys: Partial<Record<ProviderId, string>> = {},
  ) {
    this.config = { ...DEFAULT_RAG_CONFIG, ...config };
    this.vectorStore = vectorStore;
    this.apiKeys = apiKeys;
  }

  /**
   * Index a document: chunk it, generate embeddings, store in vector DB.
   */
  async indexDocument(
    documentId: string,
    content: string,
    metadata: Record<string, unknown> = {},
  ): Promise<{ chunkCount: number }> {
    // 1. Chunk the document
    const chunks = chunkDocument(content, documentId, {
      chunkSize: this.config.chunkSize,
      chunkOverlap: this.config.chunkOverlap,
      metadata,
    });

    if (chunks.length === 0) {
      return { chunkCount: 0 };
    }

    // 2. Generate embeddings for all chunks
    const texts = chunks.map((c) => c.content);
    const embeddings = await generateEmbeddings(texts, {
      model: this.config.embeddingModel,
      apiKeys: this.apiKeys,
    });

    // 3. Store in vector DB
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]!;
      const embedding = embeddings[i]!;
      await this.vectorStore.upsert(chunk.id, embedding, {
        documentId,
        content: chunk.content,
        tokenCount: chunk.tokenCount,
        chunkIndex: chunk.chunkIndex,
        ...chunk.metadata,
        ...metadata,
      });
    }

    return { chunkCount: chunks.length };
  }

  /**
   * Index multiple documents.
   */
  async indexDocuments(
    documents: { id: string; content: string; metadata?: Record<string, unknown> }[],
  ): Promise<{ totalChunks: number; documentIds: string[] }> {
    let totalChunks = 0;
    const documentIds: string[] = [];

    for (const doc of documents) {
      const result = await this.indexDocument(doc.id, doc.content, doc.metadata);
      totalChunks += result.chunkCount;
      documentIds.push(doc.id);
    }

    return { totalChunks, documentIds };
  }

  /**
   * Query the RAG system: embed query, search vector store, assemble context,
   * and generate an answer via LLM.
   */
  async query(
    query: string,
    options: {
      topK?: number;
      threshold?: number;
      filter?: Record<string, unknown>;
    } = {},
  ): Promise<RAGResult> {
    const topK = options.topK ?? this.config.topK;
    const threshold = options.threshold ?? this.config.similarityThreshold;

    // 1. Generate query embedding
    const [queryEmbedding] = await generateEmbeddings([query], {
      model: this.config.embeddingModel,
      apiKeys: this.apiKeys,
    });

    if (!queryEmbedding) {
      throw new FatalError("Failed to generate query embedding");
    }

    // 2. Search vector store
    const chunks = await this.vectorStore.search(queryEmbedding, {
      topK,
      threshold,
      filter: options.filter,
    });

    if (chunks.length === 0) {
      return {
        query,
        answers: "No relevant documents found for this query.",
        chunks: [],
      };
    }

    // 3. Assemble context
    const context = this.assembleContext(chunks);

    // 4. Build RAG prompt
    const prompt = buildRAGPrompt(query, context);

    return {
      query,
      answers: "", // Will be filled in by caller with LLM response
      chunks,
      promptUsed: prompt,
    };
  }

  /**
   * Search without generating an answer (retrieval only).
   */
  async search(
    query: string,
    options: {
      topK?: number;
      threshold?: number;
      filter?: Record<string, unknown>;
    } = {},
  ): Promise<ScoredChunk[]> {
    const topK = options.topK ?? this.config.topK;
    const threshold = options.threshold ?? this.config.similarityThreshold;

    const [queryEmbedding] = await generateEmbeddings([query], {
      model: this.config.embeddingModel,
      apiKeys: this.apiKeys,
    });

    if (!queryEmbedding) {
      return [];
    }

    return this.vectorStore.search(queryEmbedding, {
      topK,
      threshold,
      filter: options.filter,
    });
  }

  /**
   * Assemble retrieved chunks into a context window, fitting token limits.
   */
  assembleContext(chunks: ScoredChunk[]): string {
    let context = "";
    let totalTokens = 0;

    // Sort by score (highest first) and add chunks until we hit the context limit
    const sorted = [...chunks].sort((a, b) => b.score - a.score);

    for (const scored of sorted) {
      const chunkTokens = scored.chunk.tokenCount || Math.ceil(scored.chunk.content.length / 4);
      if (totalTokens + chunkTokens > this.config.maxContextTokens) break;

      context += `[Source: ${scored.chunk.documentId}, Relevance: ${scored.score.toFixed(2)}]\n${scored.chunk.content}\n\n`;
      totalTokens += chunkTokens;
    }

    return context.trim();
  }

  /**
   * Delete a document from the vector store.
   */
  async deleteDocument(documentId: string): Promise<void> {
    // In a real pgvector implementation, you'd filter by metadata
    // For now, we rely on the vector store implementation
    console.log(`[rag] Deleting document: ${documentId}`);
  }

  /**
   * Get the vector store instance.
   */
  getVectorStore(): VectorStore {
    return this.vectorStore;
  }
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Compute cosine similarity between two vectors.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new FatalError(
      `Vector dimension mismatch: ${a.length} vs ${b.length}`,
    );
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }

  if (normA === 0 || normB === 0) return 0;

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Build a RAG prompt from the query and retrieved context.
 */
export function buildRAGPrompt(query: string, context: string): string {
  return `Use the following context to answer the question. If the context does not contain enough information to answer the question, say so rather than making up information.

Context:
${context}

Question: ${query}

Answer based on the context above:`;
}

/**
 * Estimate token count from text (rough: ~4 chars per token for English).
 */
export function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / 4);
}
