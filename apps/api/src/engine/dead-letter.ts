// ============================================================================
// FlowMind Workflow Engine — Dead Letter Queue
// ============================================================================
// When a step exhausts all retries, its full context is written to the
// dead_letter_events table for manual inspection and replay.

import type { NodeResult, ExecutionContext, DAGNode } from "./types.js";

/** Database interface for the dead letter queue (caller provides the DB client) */
export interface DeadLetterStore {
  insert(params: {
    executionId: string;
    stepId?: string;
    workflowId: string;
    nodeId?: string;
    payload: Record<string, unknown>;
    error: Record<string, unknown>;
    retryCount: number;
  }): Promise<void>;
}

/**
 * Write a failed step to the dead letter queue.
 * Called when a node exhausts all retry attempts.
 */
export async function writeToDeadLetter(
  store: DeadLetterStore,
  params: {
    executionId: string;
    stepId?: string;
    workflowId: string;
    nodeId?: string;
    node: DAGNode;
    context: ExecutionContext;
    result: NodeResult;
  },
): Promise<void> {
  const errorPayload: Record<string, unknown> = {
    message: params.result.error?.message ?? "Unknown error",
    name: params.result.error?.name ?? "Error",
    stack: params.result.error?.stack ?? null,
  };

  // Include error cause chain if available
  let cause = (params.result.error as Error & { cause?: Error })?.cause;
  if (cause) {
    errorPayload.cause = {
      message: cause.message,
      name: cause.name,
    };
  }

  const payload: Record<string, unknown> = {
    nodeId: params.node.id,
    nodeType: params.node.type,
    nodeLabel: params.node.label,
    nodeConfig: params.node.config,
    triggerPayload: params.context.triggerPayload,
    variables: params.context.variables,
  };

  try {
    await store.insert({
      executionId: params.executionId,
      stepId: params.stepId,
      workflowId: params.workflowId,
      nodeId: params.nodeId,
      payload,
      error: errorPayload,
      retryCount: params.result.retryCount,
    });
  } catch (err) {
    // Log but don't throw — dead letter writing should never break the main flow
    console.error(
      `[dead-letter] Failed to write dead letter for node ${params.node.id}:`,
      err,
    );
  }
}

/**
 * Create a Drizzle-based DeadLetterStore from the DB client.
 */
export function createDrizzleDeadLetterStore(db: {
  insert: (table: unknown) => { values: (data: unknown) => Promise<unknown> };
}): DeadLetterStore {
  return {
    async insert(params) {
      // Dynamic import to avoid circular deps — caller passes the schema table
      const { deadLetterEvents } = await import("../db/schema/index.js");
      await db
        .insert(deadLetterEvents)
        .values({
          executionId: params.executionId,
          stepId: params.stepId,
          workflowId: params.workflowId,
          nodeId: params.nodeId,
          payload: params.payload,
          error: params.error,
          retryCount: params.retryCount,
        });
    },
  };
}
