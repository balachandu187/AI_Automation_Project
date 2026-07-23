// ============================================================================
// FlowMind Workflow Engine — Node Handler Registry
// ============================================================================
// Maps node types to their handler implementations.
// Handlers are stateless — context is passed in.

import type { NodeHandler, DAGNode } from "../types.js";
import { TriggerHandler } from "./trigger.js";
import { ActionHandler } from "./action.js";
import { ConditionHandler } from "./condition.js";
import { AIAgentHandler } from "./ai-agent.js";
import { ApprovalHandler } from "./approval.js";

/** Registry of all available node handlers */
const handlers: Map<string, NodeHandler> = new Map();

// Register built-in handlers
const builtInHandlers: NodeHandler[] = [
  new TriggerHandler(),
  new ActionHandler(),
  new ConditionHandler(),
  new AIAgentHandler(),
  new ApprovalHandler(),
];

for (const handler of builtInHandlers) {
  handlers.set(handler.type, handler);
}

/**
 * Get the handler for a given node type.
 * Supports aliases: "http_request" → action handler, etc.
 */
export function getHandler(nodeType: string): NodeHandler | undefined {
  // Direct match
  if (handlers.has(nodeType)) return handlers.get(nodeType);

  // Alias resolution
  const aliases: Record<string, string> = {
    http_request: "action",
    data_transform: "action",
    code: "action",
    notification: "action",
    delay: "action",
    ai_llm: "ai_agent",
    ai_router: "ai_agent",
    ai_extract: "ai_agent",
    ai_summarize: "ai_agent",
  };

  const canonicalType = aliases[nodeType] || nodeType;
  return handlers.get(canonicalType);
}

/**
 * Register a custom node handler (for extensibility / integration SDK).
 */
export function registerHandler(handler: NodeHandler): void {
  handlers.set(handler.type, handler);
}

/**
 * Validate a node's configuration using its registered handler.
 */
export function validateNode(node: DAGNode): { valid: boolean; errors: string[] } {
  const handler = getHandler(node.type);
  if (!handler) {
    return { valid: false, errors: [`No handler registered for node type: ${node.type}`] };
  }
  return handler.validate(node.config as Record<string, unknown>);
}

/**
 * Return all registered handler types for introspection.
 */
export function getRegisteredTypes(): string[] {
  return Array.from(handlers.keys());
}

export { TriggerHandler, ActionHandler, ConditionHandler, AIAgentHandler, ApprovalHandler };
