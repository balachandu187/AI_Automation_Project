// ============================================================================
// FlowMind Workflow Engine — Core Types
// ============================================================================

/** Execution status for a step or overall execution */
export type ExecutionStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "skipped"
  | "awaiting_approval"
  | "cancelled";

/** Trigger types supported by workflows */
export type TriggerType =
  | "manual"
  | "webhook"
  | "schedule"
  | "event"
  | "workflow_call";

/** Node types in the DAG */
export type NodeType =
  | "trigger"
  | "action"
  | "condition"
  | "ai_agent"
  | "approval"
  | "delay"
  | "code"
  | "loop"
  | "merge"
  | "http_request";

/** A single node definition from the database */
export interface DAGNode {
  id: string;
  type: string;
  label: string;
  config: Record<string, unknown>;
}

/** An edge definition from the database */
export interface DAGEdge {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  condition?: Record<string, unknown> | null;
}

/** The full directed acyclic graph */
export interface DAG {
  nodes: Map<string, DAGNode>;
  edges: DAGEdge[];
  /** Adjacency list: nodeId → outgoing nodeIds */
  adjacency: Map<string, string[]>;
  /** Reverse adjacency: nodeId → incoming nodeIds */
  reverseAdjacency: Map<string, string[]>;
}

/** Result of a single node execution */
export interface NodeResult {
  nodeId: string;
  status: ExecutionStatus;
  output?: Record<string, unknown>;
  error?: Error;
  durationMs: number;
  retryCount: number;
}

/** Execution context passed through the DAG */
export interface ExecutionContext {
  executionId: string;
  workflowId: string;
  workspaceId: string;
  triggerType: TriggerType;
  triggerPayload: Record<string, unknown>;
  /** Accumulated node outputs, keyed by nodeId */
  nodeOutputs: Map<string, Record<string, unknown>>;
  /** User-defined workflow variables */
  variables: Record<string, unknown>;
  /** Whether execution has been terminated early */
  terminated: boolean;
  /** Termination reason if any */
  terminationReason?: string;
  startedAt: Date;
}

/** Validation result from a node handler */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/** Configuration for a node handler */
export interface NodeConfig {
  [key: string]: unknown;
}

/** Node handler interface — all node types implement this */
export interface NodeHandler {
  readonly type: NodeType;
  execute(context: ExecutionContext, node: DAGNode): Promise<NodeResult>;
  validate(config: NodeConfig): ValidationResult;
}

/** Options for the WorkflowExecutor */
export interface ExecutorOptions {
  /** Max concurrent nodes within a level (default: 5) */
  maxConcurrency?: number;
  /** Global execution timeout in ms (default: 15 min) */
  timeoutMs?: number;
  /** Whether to emit WebSocket events (default: true) */
  emitEvents?: boolean;
  /** Callback for step events (WebSocket/pubsub) */
  onStepEvent?: (event: StepEvent) => void | Promise<void>;
}

/** Event emitted per step execution */
export interface StepEvent {
  type: "node.started" | "node.completed" | "node.failed" | "node.skipped" | "node.awaiting_approval";
  executionId: string;
  nodeId: string;
  nodeType: string;
  status: ExecutionStatus;
  output?: Record<string, unknown>;
  error?: string;
  durationMs?: number;
  timestamp: Date;
}

/** Execution job data passed to the BullMQ queue */
export interface ExecutionJobData {
  executionId: string;
  workflowId: string;
  workspaceId: string;
  triggerType: TriggerType;
  triggerPayload: Record<string, unknown>;
}
