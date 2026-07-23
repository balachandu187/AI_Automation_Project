// ============================================================================
// FlowMind API — Integration Tests
// ============================================================================
// Tests use Fastify's inject() method for HTTP-level testing.
// Database layer is mocked to avoid requiring a running PostgreSQL.
import { describe, it, expect, beforeAll, vi } from "vitest";
import Fastify from "fastify";
import { workspaceRoutes } from "../routes/workspaces.js";
import { workflowRoutes } from "../routes/workflows.js";
import { nodeRoutes } from "../routes/nodes.js";
import { edgeRoutes } from "../routes/edges.js";
import { executionRoutes } from "../routes/executions.js";
import { integrationRoutes } from "../routes/integrations.js";
import { attachRequestId, errorHandler } from "../routes/middleware.js";

// ---------------------------------------------------------------------------
// Mock the database module
// ---------------------------------------------------------------------------
const mockDb = {
  query: {
    workspaces: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    workflows: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    workflowNodes: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    workflowEdges: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    workflowVersions: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    executions: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    executionSteps: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    integrations: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    workspaceMembers: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    organizationMembers: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
  },
  insert: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  select: vi.fn(),
};

// Mock the db module — must be hoisted
vi.mock("../db/index.js", () => ({
  db: mockDb,
  schema: {
    workspaces: { id: "id", name: "name", slug: "slug", orgId: "orgId", createdBy: "createdBy", createdAt: "createdAt", updatedAt: "updatedAt" },
    workspaceMembers: { workspaceId: "workspaceId", userId: "userId", role: "role", createdAt: "createdAt", id: "id" },
    workflows: { id: "id", workspaceId: "workspaceId", name: "name", description: "description", status: "status", triggerType: "triggerType", triggerConfig: "triggerConfig", createdBy: "createdBy", createdAt: "createdAt", updatedAt: "updatedAt" },
    workflowNodes: { id: "id", workflowId: "workflowId", type: "type", label: "label", config: "config", positionX: "positionX", positionY: "positionY", createdAt: "createdAt", updatedAt: "updatedAt" },
    workflowEdges: { id: "id", workflowId: "workflowId", sourceNodeId: "sourceNodeId", targetNodeId: "targetNodeId", condition: "condition", createdAt: "createdAt" },
    workflowVersions: { id: "id", workflowId: "workflowId", versionNumber: "versionNumber", snapshot: "snapshot", createdBy: "createdBy", createdAt: "createdAt" },
    executions: { id: "id", workflowId: "workflowId", workflowVersionId: "workflowVersionId", status: "status", triggerType: "triggerType", triggerPayload: "triggerPayload", startedAt: "startedAt", completedAt: "completedAt", errorMessage: "errorMessage", createdAt: "createdAt" },
    executionSteps: { id: "id", executionId: "executionId", nodeId: "nodeId", status: "status", input: "input", output: "output", error: "error", startedAt: "startedAt", completedAt: "completedAt", retryCount: "retryCount", attemptMax: "attemptMax", createdAt: "createdAt" },
    integrations: { id: "id", workspaceId: "workspaceId", provider: "provider", name: "name", isBuiltin: "isBuiltin", createdAt: "createdAt", updatedAt: "updatedAt" },
    integrationCredentials: { id: "id", integrationId: "integrationId", credentialType: "credentialType", encryptedCredentials: "encryptedCredentials", createdAt: "createdAt", updatedAt: "updatedAt" },
    organizations: { id: "id", name: "name", slug: "slug", createdAt: "createdAt", updatedAt: "updatedAt" },
    organizationMembers: { id: "id", orgId: "orgId", userId: "userId", role: "role", createdAt: "createdAt" },
    users: { id: "id", email: "email", name: "name" },
  },
}));

// ---------------------------------------------------------------------------
// Helper to build a test Fastify instance
// ---------------------------------------------------------------------------
async function buildApp() {
  const app = Fastify({ logger: false });

  app.addHook("onRequest", attachRequestId);
  app.setErrorHandler(errorHandler);

  await app.register(workspaceRoutes, { prefix: "/api/v1/workspaces" });
  await app.register(workflowRoutes, { prefix: "/api/v1" });
  await app.register(nodeRoutes, { prefix: "/api/v1" });
  await app.register(edgeRoutes, { prefix: "/api/v1" });
  await app.register(executionRoutes, { prefix: "/api/v1" });
  await app.register(integrationRoutes, { prefix: "/api/v1" });

  await app.ready();
  return app;
}

const TEST_USER_ID = "00000000-0000-0000-0000-000000000001";
const TEST_WS_ID = "00000000-0000-0000-0000-000000000010";
const TEST_WF_ID = "00000000-0000-0000-0000-000000000020";

function authHeaders(userId = TEST_USER_ID) {
  return { "x-user-id": userId, "content-type": "application/json" };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("API Integration Tests", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    app = await buildApp();
  });

  // ---- Workspaces ----
  describe("Workspaces", () => {
    it("POST /api/v1/workspaces — requires auth", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/workspaces",
        payload: { name: "Test WS", slug: "test-ws" },
      });
      expect(res.statusCode).toBe(401);
      expect(res.json().error.code).toBe("UNAUTHORIZED");
    });

    it("POST /api/v1/workspaces — validates body", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/workspaces",
        headers: authHeaders(),
        payload: { name: "", slug: "INVALID" },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe("VALIDATION_ERROR");
    });

    it("POST /api/v1/workspaces — creates workspace", async () => {
      // Mock: no existing slug conflict
      mockDb.query.workspaces.findFirst.mockResolvedValueOnce(null);
      // Mock: org member lookup
      mockDb.query.organizationMembers.findFirst.mockResolvedValueOnce({
        orgId: "00000000-0000-0000-0000-000000000100",
        userId: TEST_USER_ID,
        role: "member",
      });
      // Mock: insert workspace
      (mockDb.insert as ReturnType<typeof vi.fn>).mockReturnValueOnce({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{
            id: TEST_WS_ID,
            name: "Test Workspace",
            slug: "test-workspace",
            orgId: "00000000-0000-0000-0000-000000000100",
            createdBy: TEST_USER_ID,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }]),
        }),
      });
      // Mock: insert workspace member
      (mockDb.insert as ReturnType<typeof vi.fn>).mockReturnValueOnce({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: "mem-1" }]),
        }),
      });

      const res = await app.inject({
        method: "POST",
        url: "/api/v1/workspaces",
        headers: authHeaders(),
        payload: { name: "Test Workspace", slug: "test-workspace" },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.data).toBeDefined();
      expect(body.data.name).toBe("Test Workspace");
    });

    it("GET /api/v1/workspaces — lists workspaces", async () => {
      mockDb.query.workspaceMembers.findMany.mockResolvedValueOnce([
        { workspaceId: TEST_WS_ID, userId: TEST_USER_ID, role: "owner" },
      ]);
      mockDb.query.workspaces.findMany.mockResolvedValueOnce([
        { id: TEST_WS_ID, name: "Test WS", slug: "test-ws", orgId: "org-1", createdBy: TEST_USER_ID, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      ]);

      const res = await app.inject({
        method: "GET",
        url: "/api/v1/workspaces",
        headers: authHeaders(),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data).toBeDefined();
      expect(body.meta).toBeDefined();
    });

    it("GET /api/v1/workspaces/:id — returns workspace with member count", async () => {
      mockDb.query.workspaceMembers.findFirst.mockResolvedValueOnce({
        workspaceId: TEST_WS_ID, userId: TEST_USER_ID, role: "owner",
      });
      mockDb.query.workspaces.findFirst.mockResolvedValueOnce({
        id: TEST_WS_ID, name: "Test WS", slug: "test-ws", orgId: "org-1", createdBy: TEST_USER_ID, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      });
      // mock count
      mockDb.select = vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ count: 3 }]),
        }),
      });

      const res = await app.inject({
        method: "GET",
        url: `/api/v1/workspaces/${TEST_WS_ID}`,
        headers: authHeaders(),
      });
      expect(res.statusCode).toBe(200);
    });
  });

  // ---- Workflows ----
  describe("Workflows", () => {
    it("POST /api/v1/workspaces/:wsId/workflows — requires workspace membership", async () => {
      mockDb.query.workspaces.findFirst.mockResolvedValueOnce(null);

      const res = await app.inject({
        method: "POST",
        url: `/api/v1/workspaces/${TEST_WS_ID}/workflows`,
        headers: authHeaders(),
        payload: { name: "My Workflow" },
      });
      // 404 because workspace doesn't exist
      expect(res.statusCode).toBe(404);
    });

    it("POST /api/v1/workspaces/:wsId/workflows — creates workflow with trigger node", async () => {
      // Mock workspace exists
      mockDb.query.workspaces.findFirst.mockResolvedValueOnce({
        id: TEST_WS_ID, name: "Test WS", slug: "test-ws",
      });
      // Mock membership
      mockDb.query.workspaceMembers.findFirst.mockResolvedValueOnce({
        workspaceId: TEST_WS_ID, userId: TEST_USER_ID, role: "owner",
      });
      // Mock workflow insert
      (mockDb.insert as ReturnType<typeof vi.fn>).mockReturnValueOnce({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{
            id: TEST_WF_ID, workspaceId: TEST_WS_ID, name: "My Workflow",
            description: null, status: "draft", triggerType: "manual",
            triggerConfig: {}, createdBy: TEST_USER_ID,
            createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
          }]),
        }),
      });
      // Mock node insert
      (mockDb.insert as ReturnType<typeof vi.fn>).mockReturnValueOnce({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{
            id: "node-1", workflowId: TEST_WF_ID, type: "trigger",
            label: "manual trigger", config: {}, positionX: 250, positionY: 100,
          }]),
        }),
      });
      // Mock version insert
      (mockDb.insert as ReturnType<typeof vi.fn>).mockReturnValueOnce({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{
            id: "ver-1", workflowId: TEST_WF_ID, versionNumber: 1,
          }]),
        }),
      });

      const res = await app.inject({
        method: "POST",
        url: `/api/v1/workspaces/${TEST_WS_ID}/workflows`,
        headers: authHeaders(),
        payload: { name: "My Workflow" },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.data.name).toBe("My Workflow");
      expect(body.data.triggerNode).toBeDefined();
    });

    it("PATCH /api/v1/workflows/:id — updates workflow", async () => {
      mockDb.query.workflows.findFirst.mockResolvedValueOnce({
        id: TEST_WF_ID, workspaceId: TEST_WS_ID, name: "Old Name", status: "draft",
      });
      mockDb.query.workspaceMembers.findFirst.mockResolvedValueOnce({
        workspaceId: TEST_WS_ID, userId: TEST_USER_ID, role: "owner",
      });
      (mockDb.update as ReturnType<typeof vi.fn>).mockReturnValueOnce({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{
              id: TEST_WF_ID, name: "Updated Name", status: "active",
            }]),
          }),
        }),
      });

      const res = await app.inject({
        method: "PATCH",
        url: `/api/v1/workflows/${TEST_WF_ID}`,
        headers: authHeaders(),
        payload: { name: "Updated Name", status: "active" },
      });
      expect(res.statusCode).toBe(200);
    });
  });

  // ---- Nodes ----
  describe("Nodes", () => {
    it("POST /api/v1/workflows/:id/nodes — adds a node", async () => {
      mockDb.query.workflows.findFirst.mockResolvedValueOnce({
        id: TEST_WF_ID, workspaceId: TEST_WS_ID, status: "draft",
      });
      mockDb.query.workspaceMembers.findFirst.mockResolvedValueOnce({
        workspaceId: TEST_WS_ID, userId: TEST_USER_ID, role: "owner",
      });
      mockDb.query.workflowNodes.findFirst.mockResolvedValueOnce(null); // no existing trigger
      (mockDb.insert as ReturnType<typeof vi.fn>).mockReturnValueOnce({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{
            id: "node-action-1", workflowId: TEST_WF_ID, type: "action",
            label: "Send Email", config: {}, positionX: 300, positionY: 200,
          }]),
        }),
      });

      const res = await app.inject({
        method: "POST",
        url: `/api/v1/workflows/${TEST_WF_ID}/nodes`,
        headers: authHeaders(),
        payload: { type: "action", label: "Send Email", config: {}, positionX: 300, positionY: 200 },
      });
      expect(res.statusCode).toBe(201);
    });

    it("POST /api/v1/workflows/:id/nodes — rejects duplicate trigger", async () => {
      mockDb.query.workflows.findFirst.mockResolvedValueOnce({
        id: TEST_WF_ID, workspaceId: TEST_WS_ID, status: "draft",
      });
      mockDb.query.workspaceMembers.findFirst.mockResolvedValueOnce({
        workspaceId: TEST_WS_ID, userId: TEST_USER_ID, role: "owner",
      });
      mockDb.query.workflowNodes.findFirst.mockResolvedValueOnce({
        id: "existing-trigger", type: "trigger",
      }); // trigger already exists

      const res = await app.inject({
        method: "POST",
        url: `/api/v1/workflows/${TEST_WF_ID}/nodes`,
        headers: authHeaders(),
        payload: { type: "trigger", label: "Another Trigger" },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  // ---- Edges ----
  describe("Edges", () => {
    it("POST /api/v1/workflows/:id/edges — adds an edge", async () => {
      mockDb.query.workflows.findFirst.mockResolvedValueOnce({
        id: TEST_WF_ID, workspaceId: TEST_WS_ID, status: "draft",
      });
      mockDb.query.workspaceMembers.findFirst.mockResolvedValueOnce({
        workspaceId: TEST_WS_ID, userId: TEST_USER_ID, role: "owner",
      });
      mockDb.query.workflowNodes.findFirst
        .mockResolvedValueOnce({ id: "node-1", workflowId: TEST_WF_ID }) // source exists
        .mockResolvedValueOnce({ id: "node-2", workflowId: TEST_WF_ID }); // target exists
      mockDb.query.workflowEdges.findFirst.mockResolvedValueOnce(null); // no duplicate
      (mockDb.insert as ReturnType<typeof vi.fn>).mockReturnValueOnce({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{
            id: "edge-1", workflowId: TEST_WF_ID, sourceNodeId: "node-1", targetNodeId: "node-2",
          }]),
        }),
      });

      const res = await app.inject({
        method: "POST",
        url: `/api/v1/workflows/${TEST_WF_ID}/edges`,
        headers: authHeaders(),
        payload: { sourceNodeId: "node-1", targetNodeId: "node-2" },
      });
      expect(res.statusCode).toBe(201);
    });

    it("POST /api/v1/workflows/:id/edges — rejects self-loop", async () => {
      mockDb.query.workflows.findFirst.mockResolvedValueOnce({
        id: TEST_WF_ID, workspaceId: TEST_WS_ID,
      });
      mockDb.query.workspaceMembers.findFirst.mockResolvedValueOnce({
        workspaceId: TEST_WS_ID, userId: TEST_USER_ID,
      });
      mockDb.query.workflowNodes.findFirst
        .mockResolvedValueOnce({ id: "node-1", workflowId: TEST_WF_ID })
        .mockResolvedValueOnce({ id: "node-1", workflowId: TEST_WF_ID });

      const res = await app.inject({
        method: "POST",
        url: `/api/v1/workflows/${TEST_WF_ID}/edges`,
        headers: authHeaders(),
        payload: { sourceNodeId: "node-1", targetNodeId: "node-1" },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  // ---- Executions ----
  describe("Executions", () => {
    it("POST /api/v1/workflows/:id/execute — triggers execution", async () => {
      mockDb.query.workflows.findFirst.mockResolvedValueOnce({
        id: TEST_WF_ID, workspaceId: TEST_WS_ID, status: "active", triggerType: "manual",
      });
      mockDb.query.workspaceMembers.findFirst.mockResolvedValueOnce({
        workspaceId: TEST_WS_ID, userId: TEST_USER_ID, role: "owner",
      });
      // nodes
      mockDb.query.workflowNodes.findMany.mockResolvedValueOnce([
        { id: "node-trigger", workflowId: TEST_WF_ID, type: "trigger", label: "Trigger", config: {} },
        { id: "node-action", workflowId: TEST_WF_ID, type: "action", label: "Action", config: {} },
      ]);
      // version
      mockDb.query.workflowVersions.findFirst.mockResolvedValueOnce({
        id: "ver-1", workflowId: TEST_WF_ID, versionNumber: 1, snapshot: {},
      });
      // execution insert
      (mockDb.insert as ReturnType<typeof vi.fn>).mockReturnValueOnce({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{
            id: "exec-1", workflowId: TEST_WF_ID, status: "pending", triggerType: "manual",
          }]),
        }),
      });

      const res = await app.inject({
        method: "POST",
        url: `/api/v1/workflows/${TEST_WF_ID}/execute`,
        headers: authHeaders(),
        payload: { input: { test: true } },
      });
      expect(res.statusCode).toBe(202);
      const body = res.json();
      expect(body.data.executionId).toBeDefined();
      expect(body.data.status).toBe("pending");
    });

    it("POST /api/v1/workflows/:id/execute — rejects workflow with no nodes", async () => {
      mockDb.query.workflows.findFirst.mockResolvedValueOnce({
        id: TEST_WF_ID, workspaceId: TEST_WS_ID, status: "draft",
      });
      mockDb.query.workspaceMembers.findFirst.mockResolvedValueOnce({
        workspaceId: TEST_WS_ID, userId: TEST_USER_ID,
      });
      mockDb.query.workflowNodes.findMany.mockResolvedValueOnce([]);

      const res = await app.inject({
        method: "POST",
        url: `/api/v1/workflows/${TEST_WF_ID}/execute`,
        headers: authHeaders(),
        payload: {},
      });
      expect(res.statusCode).toBe(400);
    });

    it("POST /api/v1/executions/:id/cancel — cancels execution", async () => {
      mockDb.query.executions.findFirst.mockResolvedValueOnce({
        id: "exec-1", workflowId: TEST_WF_ID, status: "running",
      });
      mockDb.query.workflows.findFirst.mockResolvedValueOnce({
        id: TEST_WF_ID, workspaceId: TEST_WS_ID,
      });
      mockDb.query.workspaceMembers.findMany.mockResolvedValueOnce([
        { userId: TEST_USER_ID, workspaceId: TEST_WS_ID, role: "owner" },
      ]);
      (mockDb.update as ReturnType<typeof vi.fn>).mockReturnValueOnce({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined),
        }),
      });
      mockDb.query.executionSteps.findMany.mockResolvedValueOnce([]);

      const res = await app.inject({
        method: "POST",
        url: "/api/v1/executions/exec-1/cancel",
        headers: authHeaders(),
      });
      expect(res.statusCode).toBe(200);
    });
  });

  // ---- Error format ----
  describe("Error format", () => {
    it("returns consistent error shape", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/workspaces/non-uuid",
        headers: authHeaders(),
      });
      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.error).toBeDefined();
      expect(body.error.code).toBeDefined();
      expect(body.error.message).toBeDefined();
    });

    it("includes x-request-id header", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/workspaces",
        headers: authHeaders(),
      });
      expect(res.headers["x-request-id"]).toBeDefined();
    });
  });
});
