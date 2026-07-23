// ============================================================================
// FlowMind API — Workflow Edge Routes
// ============================================================================
// CRUD for edges under /api/v1/workflows/:id/edges and /api/v1/edges/:id
import type { FastifyInstance } from "fastify";
import { db, schema } from "../db/index.js";
import {
  success,
  validate,
  requireAuth,
  uuidParam,
  createEdgeSchema,
} from "./middleware.js";
import { eq, and } from "drizzle-orm";

export async function edgeRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("onRequest", requireAuth);

  // -----------------------------------------------------------------------
  // POST /workflows/:id/edges — Add an edge between nodes
  // -----------------------------------------------------------------------
  app.post("/workflows/:id/edges", {
    preValidation: validate({ params: uuidParam, body: createEdgeSchema }),
    handler: async (request, reply) => {
      const { id: workflowId } = request.params as { id: string };
      const body = request.body as {
        sourceNodeId: string;
        targetNodeId: string;
        condition?: Record<string, unknown> | null;
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

      // Verify both nodes exist and belong to this workflow
      const sourceNode = await db.query.workflowNodes.findFirst({
        where: and(
          eq(schema.workflowNodes.id, body.sourceNodeId),
          eq(schema.workflowNodes.workflowId, workflowId),
        ),
      });

      if (!sourceNode) {
        return reply.status(400).send({
          error: {
            code: "VALIDATION_ERROR",
            message: "Source node not found in this workflow.",
          },
        });
      }

      const targetNode = await db.query.workflowNodes.findFirst({
        where: and(
          eq(schema.workflowNodes.id, body.targetNodeId),
          eq(schema.workflowNodes.workflowId, workflowId),
        ),
      });

      if (!targetNode) {
        return reply.status(400).send({
          error: {
            code: "VALIDATION_ERROR",
            message: "Target node not found in this workflow.",
          },
        });
      }

      // Prevent self-loops
      if (body.sourceNodeId === body.targetNodeId) {
        return reply.status(400).send({
          error: {
            code: "VALIDATION_ERROR",
            message: "Cannot create an edge from a node to itself.",
          },
        });
      }

      // Check for duplicate edge
      const existingEdge = await db.query.workflowEdges.findFirst({
        where: and(
          eq(schema.workflowEdges.workflowId, workflowId),
          eq(schema.workflowEdges.sourceNodeId, body.sourceNodeId),
          eq(schema.workflowEdges.targetNodeId, body.targetNodeId),
        ),
      });

      if (existingEdge) {
        return reply.status(409).send({
          error: {
            code: "CONFLICT",
            message: "An edge already exists between these nodes in this workflow.",
          },
        });
      }

      const [edge] = await db
        .insert(schema.workflowEdges)
        .values({
          workflowId,
          sourceNodeId: body.sourceNodeId,
          targetNodeId: body.targetNodeId,
          condition: body.condition ?? null,
        })
        .returning();

      reply.status(201).send(success(edge));
    },
  });

  // -----------------------------------------------------------------------
  // DELETE /edges/:id — Remove an edge
  // -----------------------------------------------------------------------
  app.delete("/edges/:id", {
    preValidation: validate({ params: uuidParam }),
    handler: async (request, reply) => {
      const { id } = request.params as { id: string };
      const userId = request.userId!;

      const edge = await db.query.workflowEdges.findFirst({
        where: eq(schema.workflowEdges.id, id),
      });

      if (!edge) {
        return reply.status(404).send({
          error: { code: "NOT_FOUND", message: "Edge not found." },
        });
      }

      // Check access via workflow → workspace
      const workflow = await db.query.workflows.findFirst({
        where: eq(schema.workflows.id, edge.workflowId),
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
          error: { code: "NOT_FOUND", message: "Edge not found." },
        });
      }

      await db
        .delete(schema.workflowEdges)
        .where(eq(schema.workflowEdges.id, id));

      reply.status(204).send();
    },
  });
}
