// ============================================================================
// FlowMind Web — Central API Client
// ============================================================================
import type {
  ApiResponse,
  Workspace,
  Workflow,
  WorkflowNode,
  WorkflowEdge,
  Execution,
  Integration,
  CreateWorkflowRequest,
  UpdateWorkflowRequest,
  CreateNodeRequest,
  UpdateNodeRequest,
  CreateEdgeRequest,
  CreateWorkspaceRequest,
  UpdateWorkspaceRequest,
  CreateIntegrationRequest,
  UpdateIntegrationRequest,
} from "../types/api";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const API_BASE = "/api/v1";

function getUserId(): string {
  // Auth stub: use X-User-Id header. In production this will come from auth context.
  return (
    localStorage.getItem("flowmind_user_id") ||
    "00000000-0000-0000-0000-000000000001"
  );
}

// ---------------------------------------------------------------------------
// Core fetch wrapper
// ---------------------------------------------------------------------------
async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<ApiResponse<T>> {
  const url = `${API_BASE}${path}`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-User-Id": getUserId(),
    ...((options.headers as Record<string, string>) || {}),
  };

  const res = await fetch(url, { ...options, headers });

  if (res.status === 204) {
    return { data: null as unknown as T };
  }

  const body = await res.json();

  if (!res.ok) {
    throw new ApiRequestError(
      body?.error?.code || "UNKNOWN",
      body?.error?.message || `Request failed with status ${res.status}`,
      res.status,
      body?.error?.details,
    );
  }

  return body as ApiResponse<T>;
}

export class ApiRequestError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
    public details?: unknown,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

// ---------------------------------------------------------------------------
// Workspaces
// ---------------------------------------------------------------------------
export const workspaces = {
  list(page = 1, limit = 20) {
    return request<Workspace[]>(`/workspaces?page=${page}&limit=${limit}`);
  },

  get(id: string) {
    return request<Workspace>(`/workspaces/${id}`);
  },

  create(data: CreateWorkspaceRequest) {
    return request<Workspace>("/workspaces", {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  update(id: string, data: UpdateWorkspaceRequest) {
    return request<Workspace>(`/workspaces/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  },

  remove(id: string) {
    return fetch(`${API_BASE}/workspaces/${id}`, {
      method: "DELETE",
      headers: { "X-User-Id": getUserId() },
    });
  },
};

// ---------------------------------------------------------------------------
// Workflows
// ---------------------------------------------------------------------------
export const workflows = {
  list(wsId: string, page = 1, limit = 20) {
    return request<Workflow[]>(
      `/workspaces/${wsId}/workflows?page=${page}&limit=${limit}`,
    );
  },

  get(id: string) {
    return request<Workflow>(`/workflows/${id}`);
  },

  create(wsId: string, data: CreateWorkflowRequest) {
    return request<Workflow>(`/workspaces/${wsId}/workflows`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  update(id: string, data: UpdateWorkflowRequest) {
    return request<Workflow>(`/workflows/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  },

  remove(id: string) {
    return fetch(`${API_BASE}/workflows/${id}`, {
      method: "DELETE",
      headers: { "X-User-Id": getUserId() },
    });
  },

  execute(id: string, input?: Record<string, unknown>) {
    return request<{ executionId: string; workflowId: string; status: string }>(
      `/workflows/${id}/execute`,
      {
        method: "POST",
        body: input ? JSON.stringify({ input }) : "{}",
      },
    );
  },
};

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------
export const nodes = {
  create(workflowId: string, data: CreateNodeRequest) {
    return request<WorkflowNode>(`/workflows/${workflowId}/nodes`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  update(id: string, data: UpdateNodeRequest) {
    return request<WorkflowNode>(`/nodes/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  },

  remove(id: string) {
    return fetch(`${API_BASE}/nodes/${id}`, {
      method: "DELETE",
      headers: { "X-User-Id": getUserId() },
    });
  },
};

// ---------------------------------------------------------------------------
// Edges
// ---------------------------------------------------------------------------
export const edges = {
  create(workflowId: string, data: CreateEdgeRequest) {
    return request<WorkflowEdge>(`/workflows/${workflowId}/edges`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  remove(id: string) {
    return fetch(`${API_BASE}/edges/${id}`, {
      method: "DELETE",
      headers: { "X-User-Id": getUserId() },
    });
  },
};

// ---------------------------------------------------------------------------
// Executions
// ---------------------------------------------------------------------------
export const executions = {
  list(workflowId: string, page = 1, limit = 20, status?: string) {
    let path = `/workflows/${workflowId}/executions?page=${page}&limit=${limit}`;
    if (status) path += `&status=${status}`;
    return request<Execution[]>(path);
  },

  get(id: string) {
    return request<Execution>(`/executions/${id}`);
  },

  cancel(id: string) {
    return request<{ id: string; status: string }>(
      `/executions/${id}/cancel`,
      { method: "POST" },
    );
  },
};

// ---------------------------------------------------------------------------
// Integrations
// ---------------------------------------------------------------------------
export const integrations = {
  list(wsId: string) {
    return request<Integration[]>(`/workspaces/${wsId}/integrations`);
  },

  create(wsId: string, data: CreateIntegrationRequest) {
    return request<Integration>(`/workspaces/${wsId}/integrations`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  update(id: string, data: UpdateIntegrationRequest) {
    return request<Integration>(`/integrations/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  },

  remove(id: string) {
    return fetch(`${API_BASE}/integrations/${id}`, {
      method: "DELETE",
      headers: { "X-User-Id": getUserId() },
    });
  },
};

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------
export function setUserId(id: string) {
  localStorage.setItem("flowmind_user_id", id);
}
