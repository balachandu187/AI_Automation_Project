// ============================================================================
// FlowMind API — Workflow Node Routes
// ============================================================================
// CRUD for nodes under /api/v1/workflows/:id/nodes and /api/v1/nodes/:id
import type { FastifyInstance } from "fastify";
import { db, schema } from "../db/index.js";
import {
  success,
  validate,
  requireAuth,
  uuidParam,
  createNodeSchema,
  updateNodeSchema,
} from "./middleware.js";
import { eq, and } from "drizzle-orm";

export async function nodeRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("onRequest", requireAuth);

  // -----------------------------------------------------------------------
  // POST /workflows/:id/nodes — Add a node to a workflow
  // -----------------------------------------------------------------------
  app.post("/workflows/:id/nodes", {
    preValidation: validate({ params: uuidParam, body: createNodeSchema }),
    handler: async (request, reply) => {
      const { id: workflowId } = request.params as { id: string };
      const body = request.body as {
        type: string;
        label: string;
        config: Record<string, unknown>;
        positionX: number;
        positionY: number;
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

      // Validate: only one trigger per workflow
      if (body.type === "trigger") {
        const existingTrigger = await db.query.workflowNodes.findFirst({
          where: and(
            eq(schema.workflowNodes.workflowId, workflowId),
            eq(schema.workflowNodes.type, "trigger"),
          ),
        });
        if (existingTrigger) {
          return reply.status(400).send({
            error: {
              code: "VALIDATION_ERROR",
              message: "Workflow already has a trigger node. Only one trigger is allowed per workflow.",
            },
          });
        }
      }

      const [node] = await db
        .insert(schema.workflowNodes)
        .values({
          workflowId,
          type: body.type,
          label: body.label,
          config: body.config,
          positionX: body.positionX,
          positionY: body.positionY,
        })
        .returning();

      reply.status(201).send(success(node));
    },
  });

  // -----------------------------------------------------------------------
  // PATCH /nodes/:id — Update node config and/or position
  // -----------------------------------------------------------------------
  app.patch("/nodes/:id", {
    preValidation: validate({ params: uuidParam, body: updateNodeSchema }),
    handler: async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = request.body as {
        label?: string;
        config?: Record<string, unknown>;
        positionX?: number;
        positionY?: number;
      };
      const userId = request.userId!;

      const node = await db.query.workflowNodes.findFirst({
        where: eq(schema.workflowNodes.id, id),
      });

      if (!node) {
        return reply.status(404).send({
          error: { code: "NOT_FOUND", message: "Node not found." },
        });
      }

      // Check access via workflow → workspace
      const workflow = await db.query.workflows.findFirst({
        where: eq(schema.workflows.id, node.workflowId),
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
          error: { code: "NOT_FOUND", message: "Node not found." },
        });
      }

      const [updated] = await db
        .update(schema.workflowNodes)
        .set({
          ...body,
          updatedAt: new Date(),
        })
        .where(eq(schema.workflowNodes.id, id))
        .returning();

      return success(updated);
    },
  });

  // -----------------------------------------------------------------------
  // DELETE /nodes/:id — Remove a node and all its connected edges
  // -----------------------------------------------------------------------
  app.delete("/nodes/:id", {
    preValidation: validate({ params: uuidParam }),
    handler: async (request, reply) => {
      const { id } = request.params as { id: string };
      const userId = request.userId!;

      const node = await db.query.workflowNodes.findFirst({
        where: eq(schema.workflowNodes.id, id),
      });

      if (!node) {
        return reply.status(404).send({
          error: { code: "NOT_FOUND", message: "Node not found." },
        });
      }

      // Check access
      const workflow = await db.query.workflows.findFirst({
        where: eq(schema.workflows.id, node.workflowId),
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
          error: { code: "NOT_FOUND", message: "Node not found." },
        });
      }

      // Cannot delete trigger node if it's the only one
      if (node.type === "trigger") {
        const nodeCount = await db.query.workflowNodes.findMany({
          where: eq(schema.workflowNodes.workflowId, node.workflowId),
        });
        if (nodeCount.length <= 1) {
          return reply.status(400).send({
            error: {
              code: "VALIDATION_ERROR",
              message: "Cannot delete the only node in a workflow.",
            },
          });
        }
      }

      // Delete connected edges first
      await db
        .delete(schema.workflowEdges)
        .where(
          eq(schema.workflowEdges.sourceNodeId, id),
        );

      await db
        .delete(schema.workflowEdges)
        .where(
          eq(schema.workflowEdges.targetNodeId, id),
        );

      // Delete the node
      await db
        .delete(schema.workflowNodes)
        .where(eq(schema.workflowNodes.id, id));

      reply.status(204).send();
    },
  });
}
