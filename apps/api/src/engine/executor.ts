// ============================================================================
// FlowMind Workflow Engine — DAG Executor
// ============================================================================
// Accepts a workflow definition (nodes + edges) and trigger payload.
// Topologically sorts the graph, executes nodes in dependency order with
// parallel branches where possible, tracks state per step, writes execution
// records, and emits step events.

import type {
  DAG,
  DAGNode,
  DAGEdge,
  ExecutionContext,
  ExecutionStatus,
  NodeResult,
  ExecutorOptions,
  StepEvent,
  TriggerType,
} from "./types.js";
import { createExecutionContext, setNodeOutput, terminateContext } from "./context.js";
import { getHandler, validateNode } from "./nodes/index.js";
import { executeWithRetry } from "./retry.js";
import { FatalError, ApprovalRequiredError } from "./errors.js";
import { writeToDeadLetter, type DeadLetterStore } from "./dead-letter.js";

/** Database interface for the executor */
export interface ExecutorDB {
  /** Update execution record */
  updateExecution(params: {
    id: string;
    status: ExecutionStatus;
    startedAt?: Date;
    completedAt?: Date;
    errorMessage?: string | null;
  }): Promise<void>;
  /** Insert execution step record */
  insertStep(params: {
    executionId: string;
    nodeId: string;
    status: ExecutionStatus;
    input?: Record<string, unknown>;
    output?: Record<string, unknown>;
    error?: Record<string, unknown>;
    retryCount?: number;
    attemptMax?: number;
    startedAt?: Date;
    completedAt?: Date;
  }): Promise<{ id: string }>;
  /** Update execution step record */
  updateStep(params: {
    id: string;
    status: ExecutionStatus;
    output?: Record<string, unknown>;
    error?: Record<string, unknown>;
    retryCount?: number;
    completedAt?: Date;
  }): Promise<void>;
  /** Load workflow nodes */
  getWorkflowNodes(workflowId: string): Promise<DAGNode[]>;
  /** Load workflow edges */
  getWorkflowEdges(workflowId: string): Promise<DAGEdge[]>;
}

/**
 * Build a DAG from arrays of nodes and edges.
 */
export function buildDAG(nodes: DAGNode[], edges: DAGEdge[]): DAG {
  const nodeMap = new Map<string, DAGNode>();
  const adjacency = new Map<string, string[]>();
  const reverseAdjacency = new Map<string, string[]>();

  for (const node of nodes) {
    nodeMap.set(node.id, node);
    adjacency.set(node.id, []);
    reverseAdjacency.set(node.id, []);
  }

  for (const edge of edges) {
    const outEdges = adjacency.get(edge.sourceNodeId) || [];
    outEdges.push(edge.targetNodeId);
    adjacency.set(edge.sourceNodeId, outEdges);

    const inEdges = reverseAdjacency.get(edge.targetNodeId) || [];
    inEdges.push(edge.sourceNodeId);
    reverseAdjacency.set(edge.targetNodeId, inEdges);
  }

  return { nodes: nodeMap, edges, adjacency, reverseAdjacency };
}

/**
 * Topologically sort a DAG returning levels of nodes that can execute in parallel.
 * Uses Kahn's algorithm (BFS-based).
 * Throws if a cycle is detected.
 */
export function topologicalSort(dag: DAG): string[][] {
  const inDegree = new Map<string, number>();
  const levels: string[][] = [];

  // Initialize in-degree for all nodes
  for (const nodeId of dag.nodes.keys()) {
    inDegree.set(nodeId, dag.reverseAdjacency.get(nodeId)?.length || 0);
  }

  // Queue for BFS: nodes with in-degree 0
  let queue: string[] = [];
  for (const [nodeId, degree] of inDegree) {
    if (degree === 0) queue.push(nodeId);
  }

  let processed = 0;
  const totalNodes = dag.nodes.size;

  while (queue.length > 0) {
    // All nodes at this level can execute in parallel
    levels.push([...queue]);

    const nextQueue: string[] = [];

    for (const nodeId of queue) {
      processed++;
      const neighbors = dag.adjacency.get(nodeId) || [];
      for (const neighbor of neighbors) {
        const newDegree = (inDegree.get(neighbor) || 1) - 1;
        inDegree.set(neighbor, newDegree);
        if (newDegree === 0) {
          nextQueue.push(neighbor);
        }
      }
    }

    queue = nextQueue;
  }

  if (processed !== totalNodes) {
    throw new FatalError("Cycle detected in workflow DAG");
  }

  return levels;
}

/**
 * Validate the DAG structure:
 * - Must have at least one node
 * - Must have at least one trigger node
 * - All edge references must resolve to existing nodes
 * - No cycles
 */
export function validateDAG(dag: DAG): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (dag.nodes.size === 0) {
    errors.push("Workflow must have at least one node");
  }

  const hasTrigger = Array.from(dag.nodes.values()).some(
    (n) => n.type === "trigger",
  );
  if (!hasTrigger) {
    errors.push("Workflow must have a trigger node");
  }

  for (const edge of dag.edges) {
    if (!dag.nodes.has(edge.sourceNodeId)) {
      errors.push(`Edge references unknown source node: ${edge.sourceNodeId}`);
    }
    if (!dag.nodes.has(edge.targetNodeId)) {
      errors.push(`Edge references unknown target node: ${edge.targetNodeId}`);
    }
  }

  // Check for cycles via topological sort
  try {
    topologicalSort(dag);
  } catch (err) {
    errors.push(
      err instanceof Error ? err.message : "Invalid DAG structure",
    );
  }

  // Validate individual node configs
  for (const node of dag.nodes.values()) {
    const validation = validateNode(node);
    if (!validation.valid) {
      for (const err of validation.errors) {
        errors.push(`Node "${node.label}" (${node.id}): ${err}`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Filter edges to only return outgoing edges for a given node.
 */
export function getOutgoingEdges(dag: DAG, nodeId: string, branch?: string): string[] {
  const allOutgoing = dag.adjacency.get(nodeId) || [];

  if (!branch) return allOutgoing;

  // If branch is specified, filter edges by condition label
  // Edges without a condition always pass
  const filtered: string[] = [];
  for (const edge of dag.edges) {
    if (edge.sourceNodeId !== nodeId) continue;
    if (!edge.condition) {
      filtered.push(edge.targetNodeId);
    } else if ((edge.condition as Record<string, unknown>).branch === branch) {
      filtered.push(edge.targetNodeId);
    }
  }

  return filtered.length > 0 ? filtered : allOutgoing;
}

/**
 * The main Workflow Executor.
 * Executes a workflow DAG, tracking state and emitting events.
 */
export class WorkflowExecutor {
  private db: ExecutorDB;
  private deadLetterStore: DeadLetterStore | null;
  private options: Required<ExecutorOptions>;

  constructor(
    db: ExecutorDB,
    deadLetterStore?: DeadLetterStore,
    options: ExecutorOptions = {},
  ) {
    this.db = db;
    this.deadLetterStore = deadLetterStore || null;
    this.options = {
      maxConcurrency: options.maxConcurrency ?? 5,
      timeoutMs: options.timeoutMs ?? 900_000, // 15 minutes
      emitEvents: options.emitEvents ?? true,
      onStepEvent: options.onStepEvent || (() => {}),
    };
  }

  /**
   * Execute a workflow by its ID.
   * This is the main entry point.
   */
  async execute(params: {
    executionId: string;
    workflowId: string;
    workspaceId: string;
    triggerType: TriggerType;
    triggerPayload: Record<string, unknown>;
    variables?: Record<string, unknown>;
  }): Promise<{
    status: ExecutionStatus;
    output: Record<string, unknown>;
    steps: Map<string, NodeResult>;
  }> {
    const {
      executionId,
      workflowId,
      workspaceId,
      triggerType,
      triggerPayload,
      variables,
    } = params;

    // 1. Load workflow DAG
    const nodes = await this.db.getWorkflowNodes(workflowId);
    const edges = await this.db.getWorkflowEdges(workflowId);
    const dag = buildDAG(nodes, edges);

    // 2. Validate DAG
    const dagValidation = validateDAG(dag);
    if (!dagValidation.valid) {
      await this.db.updateExecution({
        id: executionId,
        status: "failed",
        errorMessage: dagValidation.errors.join("; "),
        startedAt: new Date(),
        completedAt: new Date(),
      });
      return {
        status: "failed",
        output: { errors: dagValidation.errors },
        steps: new Map(),
      };
    }

    // 3. Mark execution as running
    await this.db.updateExecution({
      id: executionId,
      status: "running",
      startedAt: new Date(),
    });

    // 4. Create execution context
    const context = createExecutionContext({
      executionId,
      workflowId,
      workspaceId,
      triggerType,
      triggerPayload,
      variables,
    });

    // 5. Topological sort into levels
    const levels = topologicalSort(dag);

    // 6. Execute level by level
    const stepResults = new Map<string, NodeResult>();
    const stepRecordIds = new Map<string, string>(); // nodeId → step row ID

    try {
      for (const level of levels) {
        if (context.terminated) break;

        // Execute all nodes in this level concurrently with a concurrency cap
        await this.executeLevel(
          level,
          dag,
          context,
          stepResults,
          stepRecordIds,
        );
      }
    } catch (err) {
      // Global error handler
      const errorMessage =
        err instanceof Error ? err.message : String(err);
      console.error(
        `[executor] Workflow ${workflowId} execution ${executionId} failed: ${errorMessage}`,
      );
      await this.db.updateExecution({
        id: executionId,
        status: "failed",
        errorMessage,
        completedAt: new Date(),
      });
      return {
        status: "failed",
        output: { error: errorMessage },
        steps: stepResults,
      };
    }

    // 7. Determine final status
    const finalStatus: ExecutionStatus = context.terminated
      ? context.terminationReason === "approval_required"
        ? "awaiting_approval"
        : "failed"
      : "completed";

    // 8. Collect output from terminal nodes (nodes with no outgoing edges)
    const terminalNodes = Array.from(dag.nodes.keys()).filter(
      (nodeId) => (dag.adjacency.get(nodeId) || []).length === 0,
    );
    const output: Record<string, unknown> = {};
    for (const nodeId of terminalNodes) {
      const result = stepResults.get(nodeId);
      if (result?.output) {
        output[nodeId] = result.output;
      }
    }

    // 9. Update execution record
    await this.db.updateExecution({
      id: executionId,
      status: finalStatus,
      completedAt: finalStatus !== "awaiting_approval" ? new Date() : undefined,
      errorMessage: context.terminationReason,
    });

    return { status: finalStatus, output, steps: stepResults };
  }

  /**
   * Execute a single level of the DAG with concurrency control.
   */
  private async executeLevel(
    nodeIds: string[],
    dag: DAG,
    context: ExecutionContext,
    stepResults: Map<string, NodeResult>,
    stepRecordIds: Map<string, string>,
  ): Promise<void> {
    // Execute in chunks to respect maxConcurrency
    for (let i = 0; i < nodeIds.length; i += this.options.maxConcurrency) {
      if (context.terminated) break;

      const chunk = nodeIds.slice(i, i + this.options.maxConcurrency);
      const promises = chunk.map((nodeId) =>
        this.executeNode(nodeId, dag, context, stepResults, stepRecordIds),
      );

      await Promise.allSettled(promises);
    }
  }

  /**
   * Execute a single node within the DAG.
   */
  private async executeNode(
    nodeId: string,
    dag: DAG,
    context: ExecutionContext,
    stepResults: Map<string, NodeResult>,
    stepRecordIds: Map<string, string>,
  ): Promise<void> {
    const node = dag.nodes.get(nodeId);
    if (!node) {
      console.error(`[executor] Node ${nodeId} not found in DAG`);
      return;
    }

    // Skip if already executed
    if (stepResults.has(nodeId)) return;

    // Check if dependencies are satisfied
    const incomingEdges = dag.reverseAdjacency.get(nodeId) || [];
    for (const depId of incomingEdges) {
      if (!stepResults.has(depId)) {
        // Dependency hasn't executed yet — this shouldn't happen with proper
        // topological sort, but handle gracefully
        console.warn(
          `[executor] Node ${nodeId} dependency ${depId} not yet resolved`,
        );
        return;
      }
      const depResult = stepResults.get(depId)!;
      if (depResult.status === "failed") {
        // Check if this node should still run despite upstream failure
        const nodeConfig = node.config as Record<string, unknown>;
        if (nodeConfig.required !== false) {
          // Skip if upstream dependency failed
          const skipResult: NodeResult = {
            nodeId,
            status: "skipped",
            output: undefined,
            error: new FatalError(
              `Skipped due to upstream failure: ${depId}`,
            ),
            durationMs: 0,
            retryCount: 0,
          };
          stepResults.set(nodeId, skipResult);
          await this.emitStepEvent({
            type: "node.skipped",
            executionId: context.executionId,
            nodeId,
            nodeType: node.type,
            status: "skipped",
            timestamp: new Date(),
          });
          return;
        }
      }
    }

    // Create step record
    const stepRecord = await this.db.insertStep({
      executionId: context.executionId,
      nodeId,
      status: "running",
      input: { triggerPayload: context.triggerPayload },
      startedAt: new Date(),
    });
    stepRecordIds.set(nodeId, stepRecord.id);

    // Emit started event
    await this.emitStepEvent({
      type: "node.started",
      executionId: context.executionId,
      nodeId,
      nodeType: node.type,
      status: "running",
      timestamp: new Date(),
    });

    // Get handler
    const handler = getHandler(node.type);
    if (!handler) {
      const result: NodeResult = {
        nodeId,
        status: "failed",
        output: undefined,
        error: new FatalError(`No handler registered for node type: ${node.type}`),
        durationMs: 0,
        retryCount: 0,
      };
      stepResults.set(nodeId, result);
      await this.finalizeStep(stepRecord.id, context, node, result);
      return;
    }

    // Execute with retry
    const result = await executeWithRetry(
      async (n, ctx) => handler.execute(ctx, n),
      node,
      context,
    );

    // Handle approval pause
    if (result.error instanceof ApprovalRequiredError) {
      result.status = "awaiting_approval";
      terminateContext(context, "approval_required");
    }

    // Store node output in context for downstream nodes
    if (result.output) {
      setNodeOutput(context, nodeId, result.output);
    }

    stepResults.set(nodeId, result);

    // Finalize step in DB
    await this.finalizeStep(stepRecord.id, context, node, result);

    // Handle dead letter for exhausted retries
    if (result.status === "failed" && this.deadLetterStore) {
      await writeToDeadLetter(this.deadLetterStore, {
        executionId: context.executionId,
        stepId: stepRecord.id,
        workflowId: context.workflowId,
        nodeId,
        node,
        context,
        result,
      });
    }

    // If this was a critical failure, terminate
    if (result.status === "failed") {
      const nodeConfig = node.config as Record<string, unknown>;
      const onError = nodeConfig.onError as string | undefined;
      if (onError === "stop" || !onError) {
        terminateContext(
          context,
          `Node "${node.label}" failed: ${result.error?.message}`,
        );
      }
    }
  }

  /**
   * Finalize a step record in the database and emit its event.
   */
  private async finalizeStep(
    stepRecordId: string,
    context: ExecutionContext,
    node: DAGNode,
    result: NodeResult,
  ): Promise<void> {
    const errorPayload: Record<string, unknown> | undefined = result.error
      ? {
          message: result.error.message,
          name: result.error.name,
          stack: result.error.stack,
        }
      : undefined;

    await this.db.updateStep({
      id: stepRecordId,
      status: result.status,
      output: result.output,
      error: errorPayload,
      retryCount: result.retryCount,
      completedAt: new Date(),
    });

    // Emit appropriate event
    let eventType: StepEvent["type"];
    switch (result.status) {
      case "completed":
        eventType = "node.completed";
        break;
      case "failed":
        eventType = "node.failed";
        break;
      case "skipped":
        eventType = "node.skipped";
        break;
      case "awaiting_approval":
        eventType = "node.awaiting_approval";
        break;
      default:
        eventType = "node.completed";
    }

    await this.emitStepEvent({
      type: eventType,
      executionId: context.executionId,
      nodeId: node.id,
      nodeType: node.type,
      status: result.status,
      output: result.output,
      error: result.error?.message,
      durationMs: result.durationMs,
      timestamp: new Date(),
    });
  }

  /**
   * Emit a step event via the configured callback.
   */
  private async emitStepEvent(event: StepEvent): Promise<void> {
    if (this.options.emitEvents && this.options.onStepEvent) {
      try {
        await this.options.onStepEvent(event);
      } catch (err) {
        // Don't let event emission failures break execution
        console.error("[executor] Failed to emit step event:", err);
      }
    }
  }
}
