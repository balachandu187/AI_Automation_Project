// ============================================================================
// FlowMind API — Workflow Routes
// ============================================================================
// CRUD for workflows under /api/v1/workspaces/:wsId/workflows
// and /api/v1/workflows/:id
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { db, schema } from "../db/index.js";
import {
  success,
  paginated,
  validate,
  requireAuth,
  requireWorkspaceMembership,
  uuidParam,
  wsIdParam,
  createWorkflowSchema,
  updateWorkflowSchema,
  paginationQuery,
} from "./middleware.js";
import { eq, and, count, desc } from "drizzle-orm";

export async function workflowRoutes(app: FastifyInstance): Promise<void> {
  // All workflow routes require auth
  app.addHook("onRequest", requireAuth);

  // -----------------------------------------------------------------------
  // POST /workspaces/:wsId/workflows — Create a workflow with initial trigger node
  // -----------------------------------------------------------------------
  app.post("/workspaces/:wsId/workflows", {
    preValidation: validate({ params: wsIdParam, body: createWorkflowSchema }),
    preHandler: requireWorkspaceMembership,
    handler: async (request, reply) => {
      const { wsId } = request.params as { wsId: string };
      const body = request.body as {
        name: string;
        description?: string;
        triggerType: string;
        triggerConfig: Record<string, unknown>;
      };
      const userId = request.userId!;

      // Create the workflow
      const [workflow] = await db
        .insert(schema.workflows)
        .values({
          workspaceId: wsId,
          name: body.name,
          description: body.description ?? null,
          status: "draft",
          triggerType: body.triggerType,
          triggerConfig: body.triggerConfig,
          createdBy: userId,
        })
        .returning();

      if (!workflow) {
        return reply.status(500).send({
          error: { code: "INTERNAL_ERROR", message: "Failed to create workflow." },
        });
      }

      // Create a default trigger node
      const [triggerNode] = await db
        .insert(schema.workflowNodes)
        .values({
          workflowId: workflow.id,
          type: "trigger",
          label: `${body.triggerType} trigger`,
          config: body.triggerConfig,
          positionX: 250,
          positionY: 100,
        })
        .returning();

      // Create an initial workflow version
      const [version] = await db
        .insert(schema.workflowVersions)
        .values({
          workflowId: workflow.id,
          versionNumber: 1,
          snapshot: {
            nodes: triggerNode ? [triggerNode] : [],
            edges: [],
          },
          createdBy: userId,
        })
        .returning();

      reply.status(201).send(
        success({
          ...workflow,
          triggerNode,
          versionNumber: version?.versionNumber ?? 1,
        }),
      );
    },
  });

  // -----------------------------------------------------------------------
  // GET /workspaces/:wsId/workflows — List workflows with status and last execution
  // -----------------------------------------------------------------------
  app.get("/workspaces/:wsId/workflows", {
    preValidation: validate({ params: wsIdParam, query: paginationQuery }),
    preHandler: requireWorkspaceMembership,
    handler: async (request) => {
      const { wsId } = request.params as { wsId: string };
      const { page, limit } = request.query as { page: number; limit: number };
      const offset = (page - 1) * limit;

      // Count total
      const [totalRow] = await db
        .select({ count: count() })
        .from(schema.workflows)
        .where(eq(schema.workflows.workspaceId, wsId));

      const total = totalRow?.count ?? 0;

      // Fetch workflows
      const workflows = await db.query.workflows.findMany({
        where: eq(schema.workflows.workspaceId, wsId),
        orderBy: desc(schema.workflows.updatedAt),
        limit,
        offset,
      });

      // For each workflow, fetch the last execution
      const result = await Promise.all(
        workflows.map(async (wf) => {
          const [lastExec] = await db.query.executions.findMany({
            where: eq(schema.executions.workflowId, wf.id),
            orderBy: desc(schema.executions.createdAt),
            limit: 1,
          });

          return {
            ...wf,
            lastExecution: lastExec
              ? {
                  id: lastExec.id,
                  status: lastExec.status,
                  startedAt: lastExec.startedAt,
                  completedAt: lastExec.completedAt,
                }
              : null,
          };
        }),
      );

      return paginated(result, total, page, limit);
    },
  });

  // -----------------------------------------------------------------------
  // GET /workflows/:id — Get a single workflow with all nodes and edges
  // -----------------------------------------------------------------------
  app.get("/workflows/:id", {
    preValidation: validate({ params: uuidParam }),
    handler: async (request, reply) => {
      const { id } = request.params as { id: string };
      const userId = request.userId!;

      const workflow = await db.query.workflows.findFirst({
        where: eq(schema.workflows.id, id),
      });

      if (!workflow) {
        return reply.status(404).send({
          error: { code: "NOT_FOUND", message: "Workflow not found." },
        });
      }

      // Check workspace membership
      const membership = await db.query.workspaceMembers.findFirst({
        where: and(
          eq(schema.workspaceMembers.workspaceId, workflow.workspaceId),
          eq(schema.workspaceMembers.userId, userId),
        ),
      });

      if (!membership) {
        return reply.status(404).send({
          error: { code: "NOT_FOUND", message: "Workflow not found." },
        });
      }

      // Load nodes
      const nodes = await db.query.workflowNodes.findMany({
        where: eq(schema.workflowNodes.workflowId, id),
      });

      // Load edges
      const edges = await db.query.workflowEdges.findMany({
        where: eq(schema.workflowEdges.workflowId, id),
      });

      return success({
        ...workflow,
        nodes,
        edges,
      });
    },
  });

  // -----------------------------------------------------------------------
  // PATCH /workflows/:id — Update name, description, status
  // -----------------------------------------------------------------------
  app.patch("/workflows/:id", {
    preValidation: validate({ params: uuidParam, body: updateWorkflowSchema }),
    handler: async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = request.body as {
        name?: string;
        description?: string;
        status?: string;
      };
      const userId = request.userId!;

      const workflow = await db.query.workflows.findFirst({
        where: eq(schema.workflows.id, id),
      });

      if (!workflow) {
        return reply.status(404).send({
          error: { code: "NOT_FOUND", message: "Workflow not found." },
        });
      }

      // Check workspace membership
      const membership = await db.query.workspaceMembers.findFirst({
        where: and(
          eq(schema.workspaceMembers.workspaceId, workflow.workspaceId),
          eq(schema.workspaceMembers.userId, userId),
        ),
      });

      if (!membership) {
        return reply.status(404).send({
          error: { code: "NOT_FOUND", message: "Workflow not found." },
        });
      }

      const [updated] = await db
        .update(schema.workflows)
        .set({
          ...body,
          updatedAt: new Date(),
        })
        .where(eq(schema.workflows.id, id))
        .returning();

      return success(updated);
    },
  });

  // -----------------------------------------------------------------------
  // DELETE /workflows/:id — Soft-delete (archive)
  // -----------------------------------------------------------------------
  app.delete("/workflows/:id", {
    preValidation: validate({ params: uuidParam }),
    handler: async (request, reply) => {
      const { id } = request.params as { id: string };
      const userId = request.userId!;

      const workflow = await db.query.workflows.findFirst({
        where: eq(schema.workflows.id, id),
      });

      if (!workflow) {
        return reply.status(404).send({
          error: { code: "NOT_FOUND", message: "Workflow not found." },
        });
      }

      // Check workspace membership
      const membership = await db.query.workspaceMembers.findFirst({
        where: and(
          eq(schema.workspaceMembers.workspaceId, workflow.workspaceId),
          eq(schema.workspaceMembers.userId, userId),
        ),
      });

      if (!membership) {
        return reply.status(404).send({
          error: { code: "NOT_FOUND", message: "Workflow not found." },
        });
      }

      // Soft-delete: set status to archived
      await db
        .update(schema.workflows)
        .set({ status: "archived", updatedAt: new Date() })
        .where(eq(schema.workflows.id, id));

      reply.status(204).send();
    },
  });

  // -----------------------------------------------------------------------
  // POST /workflows/:id/execute — Trigger manual execution
  // -----------------------------------------------------------------------
  app.post("/workflows/:id/execute", {
    preValidation: validate({ params: uuidParam }),
    handler: async (request, reply) => {
      const { id } = request.params as { id: string };
      const userId = request.userId!;
      const body = (request.body || {}) as { input?: Record<string, unknown> };

      const workflow = await db.query.workflows.findFirst({
        where: eq(schema.workflows.id, id),
      });

      if (!workflow) {
        return reply.status(404).send({
          error: { code: "NOT_FOUND", message: "Workflow not found." },
        });
      }

      // Check workspace membership
      const membership = await db.query.workspaceMembers.findFirst({
        where: and(
          eq(schema.workspaceMembers.workspaceId, workflow.workspaceId),
          eq(schema.workspaceMembers.userId, userId),
        ),
      });

      if (!membership) {
        return reply.status(404).send({
          error: { code: "NOT_FOUND", message: "Workflow not found." },
        });
      }

      // Check that workflow has nodes
      const nodes = await db.query.workflowNodes.findMany({
        where: eq(schema.workflowNodes.workflowId, id),
      });

      if (nodes.length === 0) {
        return reply.status(400).send({
          error: {
            code: "VALIDATION_ERROR",
            message: "Workflow has no nodes. Add at least a trigger node before executing.",
          },
        });
      }

      // Get the latest version or create one
      let version = await db.query.workflowVersions.findFirst({
        where: eq(schema.workflowVersions.workflowId, id),
        orderBy: desc(schema.workflowVersions.versionNumber),
      });

      if (!version) {
        const edges = await db.query.workflowEdges.findMany({
          where: eq(schema.workflowEdges.workflowId, id),
        });

        const [newVersion] = await db
          .insert(schema.workflowVersions)
          .values({
            workflowId: id,
            versionNumber: 1,
            snapshot: { nodes, edges },
            createdBy: userId,
          })
          .returning();
        version = newVersion!;
      }

      // Create execution record
      const executionId = randomUUID();
      const input = body.input || {};

      const [execution] = await db
        .insert(schema.executions)
        .values({
          id: executionId,
          workflowId: id,
          workflowVersionId: version.id,
          status: "pending",
          triggerType: "manual",
          triggerPayload: input,
        })
        .returning();

      // Execute the workflow synchronously for now (MVP)
      // In production, this would go through BullMQ
      const { WorkflowExecutor, buildDAG, validateDAG } = await import(
        "../engine/index.js"
      );
      const { createDrizzleExecutorDB } = await import(
        "../engine/drizzle-adapter.js"
      );

      const executorDB = createDrizzleExecutorDB(
        db as unknown as Parameters<typeof createDrizzleExecutorDB>[0],
        schema,
      );

      const executor = new WorkflowExecutor(executorDB, undefined, {
        maxConcurrency: 5,
      });

      // Execute asynchronously — don't block the response
      executor
        .execute({
          executionId,
          workflowId: id,
          workspaceId: workflow.workspaceId,
          triggerType: "manual",
          triggerPayload: input,
          variables: input,
        })
        .catch((err: Error) => {
          console.error(
            `[api] Background execution ${executionId} failed:`,
            err.message,
          );
        });

      reply.status(202).send(
        success({
          executionId: execution!.id,
          workflowId: id,
          status: "pending",
          message: "Workflow execution started",
        }),
      );
    },
  });
}
