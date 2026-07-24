// ============================================================================
// FlowMind Web — API Type Definitions
// ============================================================================

// ---- Core entities ----
export interface Workspace {
  id: string;
  name: string;
  slug: string;
  orgId: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  memberCount?: number;
}

export interface Workflow {
  id: string;
  workspaceId: string;
  name: string;
  description: string | null;
  status: "draft" | "active" | "paused" | "archived";
  triggerType: string;
  triggerConfig: Record<string, unknown>;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  nodes?: WorkflowNode[];
  edges?: WorkflowEdge[];
  lastExecution?: {
    id: string;
    status: string;
    startedAt: string | null;
    completedAt: string | null;
  } | null;
  triggerNode?: WorkflowNode;
  versionNumber?: number;
}

export interface WorkflowNode {
  id: string;
  workflowId: string;
  type: "trigger" | "action" | "condition" | "ai_agent" | "approval";
  label: string;
  config: Record<string, unknown>;
  positionX: number;
  positionY: number;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowEdge {
  id: string;
  workflowId: string;
  sourceNodeId: string;
  targetNodeId: string;
  condition: Record<string, unknown> | null;
  createdAt: string;
}

export interface Execution {
  id: string;
  workflowId: string;
  workflowVersionId: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  triggerType: string;
  triggerPayload: Record<string, unknown>;
  startedAt: string | null;
  completedAt: string | null;
  errorMessage: string | null;
  createdAt: string;
  steps?: ExecutionStep[];
}

export interface ExecutionStep {
  id: string;
  executionId: string;
  nodeId: string;
  nodeType: string;
  nodeLabel: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled" | "skipped";
  input: Record<string, unknown> | null;
  output: Record<string, unknown> | null;
  error: Record<string, unknown> | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface Integration {
  id: string;
  workspaceId: string;
  provider: string;
  name: string;
  isBuiltin: boolean;
  config: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

// ---- API Response wrappers ----
export interface ApiResponse<T> {
  data: T;
  meta?: {
    total: number;
    page: number;
    limit: number;
  };
}

export interface ApiError {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

// ---- Request shapes ----
export interface CreateWorkflowRequest {
  name: string;
  description?: string;
  triggerType: string;
  triggerConfig: Record<string, unknown>;
}

export interface UpdateWorkflowRequest {
  name?: string;
  description?: string;
  status?: string;
}

export interface CreateNodeRequest {
  type: string;
  label: string;
  config: Record<string, unknown>;
  positionX: number;
  positionY: number;
}

export interface UpdateNodeRequest {
  label?: string;
  config?: Record<string, unknown>;
  positionX?: number;
  positionY?: number;
}

export interface CreateEdgeRequest {
  sourceNodeId: string;
  targetNodeId: string;
  condition?: Record<string, unknown> | null;
}

export interface CreateWorkspaceRequest {
  name: string;
  slug: string;
}

export interface UpdateWorkspaceRequest {
  name?: string;
  slug?: string;
}

export interface CreateIntegrationRequest {
  provider: string;
  name: string;
  isBuiltin: boolean;
  config: Record<string, unknown>;
}

export interface UpdateIntegrationRequest {
  name?: string;
  isBuiltin?: boolean;
  config?: Record<string, unknown>;
}
