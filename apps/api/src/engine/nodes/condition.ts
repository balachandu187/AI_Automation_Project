// ============================================================================
// FlowMind Workflow Engine — Condition Node Handler
// ============================================================================
// Evaluates conditions and determines which branch path to follow.
// Supports comparison operators, compound conditions (AND/OR/NOT).

import type { NodeHandler, NodeConfig, NodeResult, ExecutionContext, DAGNode } from "../types.js";
import { FatalError } from "../errors.js";
import { resolveConfig } from "../context.js";

/** Supported comparison operators */
type ComparisonOp = "equals" | "not_equals" | "gt" | "gte" | "lt" | "lte" | "contains" | "not_contains" | "regex" | "is_empty" | "is_not_empty" | "is_null" | "is_not_null" | "in" | "not_in";

/** A single condition rule */
interface ConditionRule {
  field: string;
  operator: ComparisonOp;
  value?: unknown;
}

/** A compound condition */
interface ConditionGroup {
  logic: "and" | "or" | "not";
  conditions: (ConditionRule | ConditionGroup)[];
}

export class ConditionHandler implements NodeHandler {
  readonly type = "condition" as const;

  validate(config: NodeConfig): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!config.condition) {
      errors.push("condition configuration is required");
      return { valid: false, errors };
    }

    const condition = config.condition as Record<string, unknown>;
    if (!condition.type) {
      errors.push("condition.type is required (simple or compound)");
    }

    if (condition.type === "simple") {
      const rule = condition as unknown as ConditionRule;
      if (!rule.field) errors.push("condition.field is required");
      if (!rule.operator) {
        errors.push("condition.operator is required");
      } else {
        const validOps: ComparisonOp[] = [
          "equals", "not_equals", "gt", "gte", "lt", "lte",
          "contains", "not_contains", "regex",
          "is_empty", "is_not_empty", "is_null", "is_not_null",
          "in", "not_in",
        ];
        if (!validOps.includes(rule.operator)) {
          errors.push(`Invalid operator: ${rule.operator}`);
        }
      }
    }

    return { valid: errors.length === 0, errors };
  }

  async execute(
    context: ExecutionContext,
    node: DAGNode,
  ): Promise<NodeResult> {
    const startTime = Date.now();
    const config = resolveConfig(
      node.config as Record<string, unknown>,
      context,
    ) as Record<string, unknown>;

    const condition = config.condition as Record<string, unknown>;
    const conditionType = condition.type as string;

    let result: boolean;
    try {
      if (conditionType === "simple") {
        result = this.evaluateRule(condition as unknown as ConditionRule);
      } else if (conditionType === "compound") {
        result = this.evaluateGroup(condition as unknown as ConditionGroup);
      } else {
        throw new FatalError(`Unknown condition type: ${conditionType}`);
      }
    } catch (err) {
      throw new FatalError(
        `Condition evaluation failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // Determine the output branch
    const trueBranch = config.trueBranch as string | undefined;
    const falseBranch = config.falseBranch as string | undefined;

    return {
      nodeId: node.id,
      status: "completed",
      output: {
        result,
        branch: result ? trueBranch || "true" : falseBranch || "false",
        nextNodeId: result ? trueBranch : falseBranch,
      },
      durationMs: Date.now() - startTime,
      retryCount: 0,
    };
  }

  /**
   * Evaluate a single condition rule.
   */
  evaluateRule(rule: ConditionRule): boolean {
    const { field, operator, value } = rule;

    switch (operator) {
      case "is_null":
        return field == null;
      case "is_not_null":
        return field != null;
      case "is_empty":
        return field == null || field === "" || (Array.isArray(field) && field.length === 0);
      case "is_not_empty":
        return field != null && field !== "" && (!Array.isArray(field) || field.length > 0);
    }

    // For operators that need a value, ensure field is not null
    if (field == null) return false;

    switch (operator) {
      case "equals":
        return String(field) === String(value);
      case "not_equals":
        return String(field) !== String(value);
      case "gt":
        return Number(field) > Number(value);
      case "gte":
        return Number(field) >= Number(value);
      case "lt":
        return Number(field) < Number(value);
      case "lte":
        return Number(field) <= Number(value);
      case "contains":
        return String(field).includes(String(value));
      case "not_contains":
        return !String(field).includes(String(value));
      case "regex":
        try {
          return new RegExp(String(value)).test(String(field));
        } catch {
          return false;
        }
      case "in":
        return Array.isArray(value)
          ? value.some((v) => String(v) === String(field))
          : String(value).split(",").map((s: string) => s.trim()).includes(String(field));
      case "not_in":
        return Array.isArray(value)
          ? !value.some((v) => String(v) === String(field))
          : !String(value).split(",").map((s: string) => s.trim()).includes(String(field));
      default:
        return false;
    }
  }

  /**
   * Evaluate a compound condition group (AND/OR/NOT).
   */
  evaluateGroup(group: ConditionGroup): boolean {
    switch (group.logic) {
      case "and":
        return group.conditions.every((c) =>
          "logic" in c ? this.evaluateGroup(c as ConditionGroup) : this.evaluateRule(c as ConditionRule),
        );
      case "or":
        return group.conditions.some((c) =>
          "logic" in c ? this.evaluateGroup(c as ConditionGroup) : this.evaluateRule(c as ConditionRule),
        );
      case "not":
        if (group.conditions.length === 0) return true;
        const first = group.conditions[0]!;
        return !("logic" in first
          ? this.evaluateGroup(first as ConditionGroup)
          : this.evaluateRule(first as ConditionRule));
      default:
        return false;
    }
  }
}
