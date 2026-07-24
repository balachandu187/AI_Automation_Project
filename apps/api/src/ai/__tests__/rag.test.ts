// ============================================================================
// FlowMind AI — RAG Tests
// ============================================================================

import { describe, it, expect, beforeEach } from "vitest";
import {
  chunkDocument,
  cosineSimilarity,
  estimateTokenCount,
  buildRAGPrompt,
  InMemoryVectorStore,
  DEFAULT_RAG_CONFIG,
} from "../../ai/rag.js";
import type { DocumentChunk } from "../../ai/rag.js";

describe("chunkDocument", () => {
  it("splits text into chunks", () => {
    const text = "Paragraph one with some content.\n\nParagraph two is here.\n\nParagraph three wraps up.";
    const chunks = chunkDocument(text, "doc-1");

    expect(chunks.length).toBeGreaterThanOrEqual(1);
    expect(chunks[0]!.documentId).toBe("doc-1");
    expect(chunks[0]!.chunkIndex).toBe(0);
  });

  it("preserves metadata", () => {
    const text = "Test content.";
    const chunks = chunkDocument(text, "doc-1", {
      metadata: { source: "test" },
    });

    expect(chunks[0]!.metadata.source).toBe("test");
  });

  it("splits long paragraphs", () => {
    // Create a very long paragraph
    const sentence = "This is a sentence that will be repeated many times. ";
    const longText = sentence.repeat(100);

    const chunks = chunkDocument(longText, "doc-1", {
      chunkSize: 100,
      chunkOverlap: 20,
    });

    expect(chunks.length).toBeGreaterThan(1);
  });

  it("returns empty array for empty text", () => {
    const chunks = chunkDocument("", "doc-1");
    expect(chunks.length).toBe(0);
  });

  it("generates unique chunk IDs", () => {
    const chunks = chunkDocument(
      "Para 1.\n\nPara 2.",
      "doc-1",
    );

    const ids = chunks.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("cosineSimilarity", () => {
  it("returns 1 for identical vectors", () => {
    const vec = [1, 2, 3];
    expect(cosineSimilarity(vec, vec)).toBeCloseTo(1, 5);
  });

  it("returns 0 for orthogonal vectors", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 5);
  });

  it("returns ~0.5 for 60-degree vectors", () => {
    const result = cosineSimilarity([1, 0], [0.5, Math.sqrt(3) / 2]);
    expect(result).toBeCloseTo(0.5, 1);
  });

  it("returns 0 for zero vectors", () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });
});

describe("estimateTokenCount", () => {
  it("estimates roughly", () => {
    // ~4 chars per token
    expect(estimateTokenCount("hello")).toBe(2); // ceil(5/4)
    expect(estimateTokenCount("")).toBe(0);
  });
});

describe("buildRAGPrompt", () => {
  it("builds a prompt with context", () => {
    const prompt = buildRAGPrompt(
      "What is the capital?",
      "Paris is the capital of France.",
    );

    expect(prompt).toContain("What is the capital?");
    expect(prompt).toContain("Paris is the capital of France");
    expect(prompt).toContain("context");
  });
});

describe("InMemoryVectorStore", () => {
  let store: InMemoryVectorStore;

  beforeEach(() => {
    store = new InMemoryVectorStore();
  });

  it("stores and searches vectors", async () => {
    // Store two vectors: one close to query, one far
    await store.upsert("vec-1", [0.9, 0.1], {
      documentId: "doc-1",
      content: "Close content",
      tokenCount: 5,
      chunkIndex: 0,
    });
    await store.upsert("vec-2", [0.1, 0.9], {
      documentId: "doc-2",
      content: "Far content",
      tokenCount: 5,
      chunkIndex: 0,
    });

    const results = await store.search([0.95, 0.05], {
      topK: 5,
      threshold: 0.5,
    });

    expect(results.length).toBeGreaterThanOrEqual(1);
    // The closer vector should rank higher
    if (results.length >= 2) {
      expect(results[0]!.score).toBeGreaterThan(results[1]!.score);
    }
  });

  it("respects threshold", async () => {
    await store.upsert("vec-1", [1, 0], {
      documentId: "doc-1",
      content: "Content",
      tokenCount: 5,
      chunkIndex: 0,
    });

    const results = await store.search([0, 1], {
      topK: 5,
      threshold: 0.99,
    });

    // Orthogonal vectors have similarity 0, should be below threshold
    expect(results.length).toBe(0);
  });

  it("respects filters", async () => {
    await store.upsert("vec-1", [1, 0], {
      documentId: "doc-a",
      content: "Content A",
      tokenCount: 5,
      chunkIndex: 0,
    });
    await store.upsert("vec-2", [0.99, 0.01], {
      documentId: "doc-b",
      content: "Content B",
      tokenCount: 5,
      chunkIndex: 0,
    });

    const results = await store.search([1, 0], {
      topK: 5,
      filter: { documentId: "doc-b" },
    });

    expect(results.length).toBe(1);
    expect(results[0]!.chunk.documentId).toBe("doc-b");
  });

  it("deletes vectors", async () => {
    await store.upsert("vec-1", [1, 0], {
      documentId: "doc-1",
      content: "Content",
      tokenCount: 5,
      chunkIndex: 0,
    });

    await store.delete(["vec-1"]);

    const results = await store.search([1, 0], { topK: 5 });
    expect(results.length).toBe(0);
  });
});

describe("DEFAULT_RAG_CONFIG", () => {
  it("has sensible defaults", () => {
    expect(DEFAULT_RAG_CONFIG.chunkSize).toBe(512);
    expect(DEFAULT_RAG_CONFIG.chunkOverlap).toBe(64);
    expect(DEFAULT_RAG_CONFIG.similarityThreshold).toBe(0.7);
    expect(DEFAULT_RAG_CONFIG.topK).toBe(10);
    expect(DEFAULT_RAG_CONFIG.maxContextTokens).toBe(8000);
  });
});
