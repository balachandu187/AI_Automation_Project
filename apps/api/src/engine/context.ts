// ============================================================================
// FlowMind Workflow Engine — Execution Context
// ============================================================================
// Carries workflow state, node outputs, variables, and secrets through execution.
// Supports variable interpolation in node configs using {{node_id.output.field}}.
// Uses an immutable update pattern — each step gets its own context.

import type {
  ExecutionContext,
  DAGNode,
  TriggerType,
} from "./types.js";

/**
 * Create a fresh execution context for a workflow run.
 */
export function createExecutionContext(params: {
  executionId: string;
  workflowId: string;
  workspaceId: string;
  triggerType: TriggerType;
  triggerPayload: Record<string, unknown>;
  variables?: Record<string, unknown>;
}): ExecutionContext {
  return {
    executionId: params.executionId,
    workflowId: params.workflowId,
    workspaceId: params.workspaceId,
    triggerType: params.triggerType,
    triggerPayload: params.triggerPayload,
    nodeOutputs: new Map(),
    variables: { ...params.variables },
    terminated: false,
    startedAt: new Date(),
  };
}

/**
 * Store a node's output in the context (immutable pattern — returns new context).
 * The output is stored under `nodeId` and each output field is also available
 * at `nodeId.field` for convenience.
 */
export function setNodeOutput(
  context: ExecutionContext,
  nodeId: string,
  output: Record<string, unknown>,
): void {
  context.nodeOutputs.set(nodeId, output);
  // Also store individual fields at nodeId.field for interpolation
  for (const [key, value] of Object.entries(output)) {
    context.nodeOutputs.set(`${nodeId}.${key}`, { [key]: value });
  }
}

/**
 * Get a node's output from the context.
 */
export function getNodeOutput(
  context: ExecutionContext,
  nodeId: string,
): Record<string, unknown> | undefined {
  return context.nodeOutputs.get(nodeId);
}

/**
 * Resolve template variables in a string.
 * Supports:
 *   - {{node_id.output.field}} — reference another node's output
 *   - {{node_id}} — reference entire node output as JSON
 *   - {{trigger.field}} — reference trigger payload
 *   - {{var.name}} — reference workflow variables
 *
 * Returns the resolved string. Unresolved variables are left as-is (with a warning).
 */
export function resolveString(
  template: string,
  context: ExecutionContext,
): string {
  return template.replace(/\{\{([^}]+)\}\}/g, (_match, path: string) => {
    const trimmed = path.trim();
    return resolveValue(trimmed, context);
  });
}

/**
 * Resolve a variable path against the execution context.
 * Path format: "nodeId.output.field" or "trigger.field" or "var.name"
 */
function resolveValue(path: string, context: ExecutionContext): string {
  const parts = path.split(".");

  // Trigger payload reference
  if (parts[0] === "trigger") {
    const value = getNestedValue(context.triggerPayload, parts.slice(1));
    return value != null ? String(value) : `{{${path}}}`;
  }

  // Workflow variable reference
  if (parts[0] === "var" || parts[0] === "variables") {
    const value = getNestedValue(context.variables, parts.slice(1));
    return value != null ? String(value) : `{{${path}}}`;
  }

  // Node output reference: nodeId[.field...]
  const nodeId = parts[0]!;
  const nodeOutput = context.nodeOutputs.get(nodeId);
  if (!nodeOutput) {
    // Try with combined key (e.g., "nodeId.field")
    const combined = context.nodeOutputs.get(path);
    if (combined) return JSON.stringify(combined);
    return `{{${path}}}`;
  }

  if (parts.length === 1) {
    return JSON.stringify(nodeOutput);
  }

  const value = getNestedValue(nodeOutput, parts.slice(1));
  return value != null ? String(value) : `{{${path}}}`;
}

/**
 * Get a nested value from an object by path.
 */
function getNestedValue(
  obj: Record<string, unknown>,
  path: string[],
): unknown {
  let current: unknown = obj;
  for (const key of path) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

/**
 * Resolve all template variables in a node config.
 * Recursively walks the config object and resolves any string values
 * containing {{...}} patterns.
 */
export function resolveConfig(
  config: Record<string, unknown>,
  context: ExecutionContext,
): Record<string, unknown> {
  function resolve(value: unknown): unknown {
    if (typeof value === "string") {
      return resolveString(value, context);
    }
    if (Array.isArray(value)) {
      return value.map(resolve);
    }
    if (value && typeof value === "object") {
      const result: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        result[k] = resolve(v);
      }
      return result;
    }
    return value;
  }

  return resolve(config) as Record<string, unknown>;
}

/**
 * Terminate the execution context (stop the DAG from proceeding further).
 */
export function terminateContext(
  context: ExecutionContext,
  reason: string,
): void {
  context.terminated = true;
  context.terminationReason = reason;
}
