// ============================================================================
// FlowMind API — Execution Routes
// ============================================================================
// Listing, detail, and cancellation of workflow executions.
import type { FastifyInstance } from "fastify";
import { db, schema } from "../db/index.js";
import {
  success,
  paginated,
  validate,
  requireAuth,
  uuidParam,
  executionListQuery,
} from "./middleware.js";
import { eq, and, count, desc } from "drizzle-orm";

export async function executionRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("onRequest", requireAuth);

  // -----------------------------------------------------------------------
  // GET /workflows/:id/executions — List executions for a workflow (paginated)
  // -----------------------------------------------------------------------
  app.get("/workflows/:id/executions", {
    preValidation: validate({ params: uuidParam, query: executionListQuery }),
    handler: async (request, reply) => {
      const { id: workflowId } = request.params as { id: string };
      const { page, limit, status } = request.query as {
        page: number;
        limit: number;
        status?: string;
      };
      const userId = request.userId!;

      // Verify workflow exists and user has access
      const workflow = await db.query.workflows.findFirst({
        where: eq(schema.workflows.id, workflowId),
      });

      if (!workflow) {
        return reply.status(404).send({
          error: { code: "NOT_FOUND", message: "Workflow not found." },
        });
      }

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

      // Build where clause
      const whereConditions = status
        ? and(
            eq(schema.executions.workflowId, workflowId),
            eq(schema.executions.status, status),
          )
        : eq(schema.executions.workflowId, workflowId);

      // Count total
      const [totalRow] = await db
        .select({ count: count() })
        .from(schema.executions)
        .where(whereConditions);

      const total = totalRow?.count ?? 0;
      const offset = (page - 1) * limit;

      const rows = await db.query.executions.findMany({
        where: whereConditions,
        orderBy: desc(schema.executions.createdAt),
        limit,
        offset,
      });

      return paginated(rows, total, page, limit);
    },
  });

  // -----------------------------------------------------------------------
  // GET /executions/:id — Get execution with all steps
  // -----------------------------------------------------------------------
  app.get("/executions/:id", {
    preValidation: validate({ params: uuidParam }),
    handler: async (request, reply) => {
      const { id } = request.params as { id: string };
      const userId = request.userId!;

      const execution = await db.query.executions.findFirst({
        where: eq(schema.executions.id, id),
      });

      if (!execution) {
        return reply.status(404).send({
          error: { code: "NOT_FOUND", message: "Execution not found." },
        });
      }

      // Check access via workflow → workspace
      const workflow = await db.query.workflows.findFirst({
        where: eq(schema.workflows.id, execution.workflowId),
      });

      if (!workflow) {
        return reply.status(404).send({
          error: { code: "NOT_FOUND", message: "Execution not found." },
        });
      }

      const membership = await db.query.workspaceMembers.findFirst({
        where: and(
          eq(schema.workspaceMembers.workspaceId, workflow.workspaceId),
          eq(schema.workspaceMembers.userId, userId),
        ),
      });

      if (!membership) {
        return reply.status(404).send({
          error: { code: "NOT_FOUND", message: "Execution not found." },
        });
      }

      // Load steps
      const steps = await db.query.executionSteps.findMany({
        where: eq(schema.executionSteps.executionId, id),
        orderBy: schema.executionSteps.createdAt,
      });

      return success({
        ...execution,
        steps,
      });
    },
  });

  // -----------------------------------------------------------------------
  // POST /executions/:id/cancel — Cancel a running execution
  // -----------------------------------------------------------------------
  app.post("/executions/:id/cancel", {
    preValidation: validate({ params: uuidParam }),
    handler: async (request, reply) => {
      const { id } = request.params as { id: string };
      const userId = request.userId!;

      const execution = await db.query.executions.findFirst({
        where: eq(schema.executions.id, id),
      });

      if (!execution) {
        return reply.status(404).send({
          error: { code: "NOT_FOUND", message: "Execution not found." },
        });
      }

      // Check access
      const workflow = await db.query.workflows.findFirst({
        where: eq(schema.workflows.id, execution.workflowId),
      });

      if (!workflow) {
        return reply.status(404).send({
          error: { code: "NOT_FOUND", message: "Execution not found." },
        });
      }

      const membership = await db.query.workspaceMembers.findFirst({
        where: and(
          eq(schema.workspaceMembers.workspaceId, workflow.workspaceId),
          eq(schema.workspaceMembers.userId, userId),
        ),
      });

      if (!membership) {
        return reply.status(404).send({
          error: { code: "NOT_FOUND", message: "Execution not found." },
        });
      }

      // Only cancel if running or pending
      if (execution.status !== "running" && execution.status !== "pending") {
        return reply.status(400).send({
          error: {
            code: "VALIDATION_ERROR",
            message: `Cannot cancel execution with status "${execution.status}".`,
          },
        });
      }

      await db
        .update(schema.executions)
        .set({
          status: "cancelled",
          completedAt: new Date(),
          errorMessage: "Cancelled by user",
        })
        .where(eq(schema.executions.id, id));

      // Also cancel any pending/running steps
      const steps = await db.query.executionSteps.findMany({
        where: eq(schema.executionSteps.executionId, id),
      });

      for (const step of steps) {
        if (step.status === "running" || step.status === "pending") {
          await db
            .update(schema.executionSteps)
            .set({
              status: "cancelled",
              completedAt: new Date(),
              error: { message: "Execution cancelled by user" },
            })
            .where(eq(schema.executionSteps.id, step.id));
        }
      }

      return success({ id, status: "cancelled" });
    },
  });
}
