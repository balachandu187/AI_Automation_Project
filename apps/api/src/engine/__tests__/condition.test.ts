// ============================================================================
// FlowMind Engine Tests — Condition Evaluation
// ============================================================================
import { describe, it, expect } from "vitest";
import { ConditionHandler } from "../nodes/condition.js";

const handler = new ConditionHandler();

describe("ConditionHandler.validate", () => {
  it("accepts a valid simple condition config", () => {
    const result = handler.validate({
      condition: {
        type: "simple",
        field: "status",
        operator: "equals",
        value: "active",
      },
    });
    expect(result.valid).toBe(true);
  });

  it("rejects missing condition", () => {
    const result = handler.validate({});
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("required"))).toBe(true);
  });

  it("rejects invalid operator", () => {
    const result = handler.validate({
      condition: {
        type: "simple",
        field: "x",
        operator: "invalid_op",
      },
    });
    expect(result.valid).toBe(false);
  });
});

describe("ConditionHandler.evaluateRule", () => {
  it("equals", () => {
    expect(handler.evaluateRule({ field: "hello", operator: "equals", value: "hello" })).toBe(true);
    expect(handler.evaluateRule({ field: "hello", operator: "equals", value: "world" })).toBe(false);
  });

  it("not_equals", () => {
    expect(handler.evaluateRule({ field: "a", operator: "not_equals", value: "b" })).toBe(true);
    expect(handler.evaluateRule({ field: "a", operator: "not_equals", value: "a" })).toBe(false);
  });

  it("gt / gte / lt / lte", () => {
    expect(handler.evaluateRule({ field: "10", operator: "gt", value: "5" })).toBe(true);
    expect(handler.evaluateRule({ field: "3", operator: "gt", value: "5" })).toBe(false);
    expect(handler.evaluateRule({ field: "5", operator: "gte", value: "5" })).toBe(true);
    expect(handler.evaluateRule({ field: "1", operator: "lt", value: "5" })).toBe(true);
    expect(handler.evaluateRule({ field: "5", operator: "lte", value: "5" })).toBe(true);
  });

  it("contains / not_contains", () => {
    expect(handler.evaluateRule({ field: "hello world", operator: "contains", value: "world" })).toBe(true);
    expect(handler.evaluateRule({ field: "hello world", operator: "contains", value: "xyz" })).toBe(false);
    expect(handler.evaluateRule({ field: "abc", operator: "not_contains", value: "xyz" })).toBe(true);
  });

  it("regex", () => {
    expect(handler.evaluateRule({ field: "abc123", operator: "regex", value: "^abc\\d+$" })).toBe(true);
    expect(handler.evaluateRule({ field: "xyz", operator: "regex", value: "^abc" })).toBe(false);
  });

  it("is_empty / is_not_empty", () => {
    expect(handler.evaluateRule({ field: "", operator: "is_empty" })).toBe(true);
    expect(handler.evaluateRule({ field: "hi", operator: "is_empty" })).toBe(false);
    expect(handler.evaluateRule({ field: "hi", operator: "is_not_empty" })).toBe(true);
    expect(handler.evaluateRule({ field: "", operator: "is_not_empty" })).toBe(false);
  });

  it("is_null / is_not_null", () => {
    expect(handler.evaluateRule({ field: null as unknown as string, operator: "is_null" })).toBe(true);
    expect(handler.evaluateRule({ field: "value", operator: "is_null" })).toBe(false);
    expect(handler.evaluateRule({ field: "value", operator: "is_not_null" })).toBe(true);
  });

  it("in / not_in (array)", () => {
    expect(handler.evaluateRule({ field: "a", operator: "in", value: ["a", "b", "c"] })).toBe(true);
    expect(handler.evaluateRule({ field: "d", operator: "in", value: ["a", "b", "c"] })).toBe(false);
    expect(handler.evaluateRule({ field: "d", operator: "not_in", value: ["a", "b"] })).toBe(true);
  });

  it("handles null field gracefully", () => {
    expect(handler.evaluateRule({ field: null as unknown as string, operator: "equals", value: "x" })).toBe(false);
    expect(handler.evaluateRule({ field: null as unknown as string, operator: "is_null" })).toBe(true);
  });
});

describe("ConditionHandler.evaluateGroup", () => {
  it("AND: all true → true", () => {
    const result = handler.evaluateGroup({
      logic: "and",
      conditions: [
        { field: "a", operator: "equals", value: "a" },
        { field: "b", operator: "equals", value: "b" },
      ],
    });
    expect(result).toBe(true);
  });

  it("AND: one false → false", () => {
    const result = handler.evaluateGroup({
      logic: "and",
      conditions: [
        { field: "a", operator: "equals", value: "a" },
        { field: "b", operator: "equals", value: "wrong" },
      ],
    });
    expect(result).toBe(false);
  });

  it("OR: any true → true", () => {
    const result = handler.evaluateGroup({
      logic: "or",
      conditions: [
        { field: "a", operator: "equals", value: "wrong" },
        { field: "b", operator: "equals", value: "b" },
      ],
    });
    expect(result).toBe(true);
  });

  it("OR: all false → false", () => {
    const result = handler.evaluateGroup({
      logic: "or",
      conditions: [
        { field: "a", operator: "equals", value: "wrong1" },
        { field: "b", operator: "equals", value: "wrong2" },
      ],
    });
    expect(result).toBe(false);
  });

  it("NOT: inverts result", () => {
    const result = handler.evaluateGroup({
      logic: "not",
      conditions: [{ field: "a", operator: "equals", value: "wrong" }],
    });
    expect(result).toBe(true);
  });

  it("nested compound conditions", () => {
    const result = handler.evaluateGroup({
      logic: "and",
      conditions: [
        {
          logic: "or",
          conditions: [
            { field: "yes", operator: "equals", value: "yes" },
            { field: "no", operator: "equals", value: "yes" },
          ],
        },
        { field: "something", operator: "is_not_empty" },
      ],
    });
    // (yes=yes OR no=yes) AND "something" is not empty
    expect(result).toBe(true); // first "yes"=yes is true, and "something" is not empty
  });
});
