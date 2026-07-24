// ============================================================================
// FlowMind AI — Confidence & Memory Tests
// ============================================================================

import { describe, it, expect, beforeEach } from "vitest";
import { ConfidenceScorer, COMMON_BUSINESS_RULES } from "../../ai/confidence.js";
import { ConversationMemory, WorkingMemory, MemoryManager } from "../../ai/memory.js";

describe("ConfidenceScorer", () => {
  let scorer: ConfidenceScorer;

  beforeEach(() => {
    scorer = new ConfidenceScorer({ threshold: 0.7 });
  });

  it("assigns high confidence to explicit confidence in output", () => {
    const output = { confidence: 0.95, answer: "The capital of France is Paris." };
    const result = scorer.assess(output);

    expect(result.score).toBeGreaterThanOrEqual(0.7);
    expect(result.factors.explicitConfidence).toBe(0.95);
    expect(result.action).toBe("accept");
  });

  it("detects low confidence output", () => {
    const output = { confidence: 0.3, answer: "I'm not sure..." };
    const result = scorer.assess(output);

    // With explicit confidence 0.3 weighted at 50%, score is moderate
    expect(result.score).toBeLessThanOrEqual(0.7);
    expect(result.action).not.toBe("accept");
  });

  it("validates against a schema", () => {
    const output = { name: "John", age: "thirty" };
    const schema = {
      type: "object",
      properties: {
        name: { type: "string" },
        age: { type: "integer" },
      },
      required: ["name", "age"],
    };

    const result = scorer.assess(output, { expectedSchema: schema });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("age"))).toBe(true);
  });

  it("validates a correct schema", () => {
    const output = { name: "John", age: 30 };
    const schema = {
      type: "object",
      properties: {
        name: { type: "string" },
        age: { type: "integer" },
      },
      required: ["name", "age"],
    };

    const result = scorer.assess(output, { expectedSchema: schema });
    expect(result.valid).toBe(true);
    expect(result.errors.length).toBe(0);
  });

  it("handles text-only output", () => {
    const result = scorer.assess("The sky is blue.");

    expect(result.score).toBeGreaterThan(0.5);
    expect(result.action).toBe("accept");
  });

  it("detects hedging language and lowers confidence", () => {
    const result1 = scorer.assess("I'm not sure, but I think the answer might be 42.");
    const result2 = scorer.assess("The answer is definitely 42.");

    // Hedging text should have lower confidence than assertive text
    expect(result1.score).toBeLessThan(result2.score);
  });

  it("returns retry action for empty output", () => {
    const result = scorer.assess("");
    expect(result.action).toBe("retry");
    expect(result.score).toBe(0);
  });

  it("extracts explicit confidence from text", () => {
    const result = scorer.assess("The answer is 42. Confidence: 0.92");
    expect(result.factors.explicitConfidence).toBe(0.92);
    expect(result.score).toBeGreaterThan(0.7);
  });
});

describe("COMMON_BUSINESS_RULES", () => {
  it("validates email format", () => {
    expect(COMMON_BUSINESS_RULES.emailMustContainAt.validate("john@doe.com")).toBe(true);
    expect(COMMON_BUSINESS_RULES.emailMustContainAt.validate("invalid-email")).toBe(true); // No email found = no error
  });

  it("validates dates in the future", () => {
    expect(COMMON_BUSINESS_RULES.dateMustBeFuture.validate("2099-01-01")).toBe(true);
    expect(COMMON_BUSINESS_RULES.dateMustBeFuture.validate("2020-01-01")).toBe(false);
  });
});

describe("ConversationMemory", () => {
  let memory: ConversationMemory;

  beforeEach(() => {
    memory = new ConversationMemory({ maxMessages: 10 });
  });

  it("adds messages", () => {
    memory.addSystemMessage("You are helpful.");
    memory.addUserMessage("Hello");
    memory.addAssistantMessage("Hi there!");

    expect(memory.length).toBe(3);
  });

  it("retrieves recent messages", () => {
    memory.addUserMessage("1");
    memory.addAssistantMessage("a");
    memory.addUserMessage("2");
    memory.addAssistantMessage("b");

    const recent = memory.getRecent(2);
    expect(recent.length).toBe(2);
    expect(recent[0]!.content).toBe("2");
    expect(recent[1]!.content).toBe("b");
  });

  it("prunes old messages", () => {
    const smallMem = new ConversationMemory({
      maxMessages: 3,
      preserveLastN: 1,
    });

    smallMem.addUserMessage("1");
    smallMem.addAssistantMessage("a");
    smallMem.addUserMessage("2");
    smallMem.addAssistantMessage("b");
    smallMem.addUserMessage("3");

    // After adding 5 messages with max 3, oldest should be pruned
    expect(smallMem.length).toBeLessThanOrEqual(3);
  });

  it("gets last assistant message", () => {
    memory.addAssistantMessage("First response");
    memory.addUserMessage("Another question");
    memory.addAssistantMessage("Second response");

    expect(memory.getLastAssistantMessage()).toBe("Second response");
  });

  it("adds tool results", () => {
    memory.addUserMessage("Call a tool");
    memory.addAssistantMessage(null, [
      {
        id: "call-1",
        type: "function",
        function: { name: "search", arguments: '{"q":"test"}' },
      },
    ]);
    memory.addToolResult("call-1", '{"results": []}');

    expect(memory.length).toBe(3);
    expect(memory.getMessages()[2]!.role).toBe("tool");
  });
});

describe("WorkingMemory", () => {
  let wm: WorkingMemory;

  beforeEach(() => {
    wm = new WorkingMemory();
  });

  it("stores and retrieves values", () => {
    wm.set("key", "value");
    expect(wm.get("key")).toBe("value");
  });

  it("returns default for missing keys", () => {
    expect(wm.getWithDefault("missing", "default")).toBe("default");
  });

  it("exports to object", () => {
    wm.set("a", 1);
    wm.set("b", "two");
    expect(wm.toObject()).toEqual({ a: 1, b: "two" });
  });

  it("imports from object", () => {
    wm.fromObject({ x: 10, y: 20 });
    expect(wm.get("x")).toBe(10);
    expect(wm.get("y")).toBe(20);
  });
});

describe("MemoryManager", () => {
  it("provides all three memory stores", () => {
    const manager = new MemoryManager();
    expect(manager.conversation).toBeDefined();
    expect(manager.working).toBeDefined();
    expect(manager.longTerm).toBeDefined();
  });

  it("clears all stores", () => {
    const manager = new MemoryManager();
    manager.conversation.addUserMessage("test");
    manager.working.set("test", "value");

    manager.clearAll();

    expect(manager.conversation.length).toBe(0);
    expect(manager.working.get("test")).toBeUndefined();
  });
});
