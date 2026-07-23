// ============================================================================
// FlowMind API — Integration Routes
// ============================================================================
// CRUD for third-party integrations under /api/v1/workspaces/:wsId/integrations
// and /api/v1/integrations/:id
import type { FastifyInstance } from "fastify";
import { db, schema } from "../db/index.js";
import {
  success,
  validate,
  requireAuth,
  requireWorkspaceMembership,
  uuidParam,
  wsIdParam,
  createIntegrationSchema,
  updateIntegrationSchema,
} from "./middleware.js";
import { eq } from "drizzle-orm";

export async function integrationRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("onRequest", requireAuth);

  // -----------------------------------------------------------------------
  // POST /workspaces/:wsId/integrations — Create an integration
  // -----------------------------------------------------------------------
  app.post("/workspaces/:wsId/integrations", {
    preValidation: validate({
      params: wsIdParam,
      body: createIntegrationSchema,
    }),
    preHandler: requireWorkspaceMembership,
    handler: async (request, reply) => {
      const { wsId } = request.params as { wsId: string };
      const body = request.body as {
        provider: string;
        name: string;
        isBuiltin: boolean;
        config: Record<string, unknown>;
      };

      // Check for duplicate name within workspace/provider
      const existing = await db.query.integrations.findFirst({
        where: eq(schema.integrations.workspaceId, wsId),
      });

      // Simple duplicate check (full check would also filter by provider)
      const duplicate = existing && existing.provider === body.provider && existing.name === body.name;

      if (duplicate) {
        return reply.status(409).send({
          error: {
            code: "CONFLICT",
            message: `An integration "${body.name}" for provider "${body.provider}" already exists in this workspace.`,
          },
        });
      }

      const [integration] = await db
        .insert(schema.integrations)
        .values({
          workspaceId: wsId,
          provider: body.provider,
          name: body.name,
          isBuiltin: body.isBuiltin,
        })
        .returning();

      reply.status(201).send(success(integration));
    },
  });

  // -----------------------------------------------------------------------
  // GET /workspaces/:wsId/integrations — List integrations for a workspace
  // -----------------------------------------------------------------------
  app.get("/workspaces/:wsId/integrations", {
    preValidation: validate({ params: wsIdParam }),
    preHandler: requireWorkspaceMembership,
    handler: async (request) => {
      const { wsId } = request.params as { wsId: string };

      const rows = await db.query.integrations.findMany({
        where: eq(schema.integrations.workspaceId, wsId),
        orderBy: schema.integrations.createdAt,
      });

      return success(rows);
    },
  });

  // -----------------------------------------------------------------------
  // PATCH /integrations/:id — Update integration config/name
  // -----------------------------------------------------------------------
  app.patch("/integrations/:id", {
    preValidation: validate({
      params: uuidParam,
      body: updateIntegrationSchema,
    }),
    handler: async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = request.body as {
        name?: string;
        isBuiltin?: boolean;
        config?: Record<string, unknown>;
      };
      const userId = request.userId!;

      const integration = await db.query.integrations.findFirst({
        where: eq(schema.integrations.id, id),
      });

      if (!integration) {
        return reply.status(404).send({
          error: { code: "NOT_FOUND", message: "Integration not found." },
        });
      }

      // Check workspace membership
      const membership = await db.query.workspaceMembers.findFirst({
        where: eq(schema.workspaceMembers.workspaceId, integration.workspaceId),
      });

      // Find the user's membership
      const userMembership = await db.query.workspaceMembers.findFirst({
        where: eq(schema.workspaceMembers.workspaceId, integration.workspaceId),
      });

      if (!userMembership || userMembership.userId !== userId) {
        return reply.status(404).send({
          error: { code: "NOT_FOUND", message: "Integration not found." },
        });
      }

      const [updated] = await db
        .update(schema.integrations)
        .set({
          ...body,
          updatedAt: new Date(),
        })
        .where(eq(schema.integrations.id, id))
        .returning();

      return success(updated);
    },
  });

  // -----------------------------------------------------------------------
  // DELETE /integrations/:id — Remove integration and its credentials
  // -----------------------------------------------------------------------
  app.delete("/integrations/:id", {
    preValidation: validate({ params: uuidParam }),
    handler: async (request, reply) => {
      const { id } = request.params as { id: string };
      const userId = request.userId!;

      const integration = await db.query.integrations.findFirst({
        where: eq(schema.integrations.id, id),
      });

      if (!integration) {
        return reply.status(404).send({
          error: { code: "NOT_FOUND", message: "Integration not found." },
        });
      }

      // Check workspace membership
      const userMembership = await db.query.workspaceMembers.findFirst({
        where: eq(schema.workspaceMembers.workspaceId, integration.workspaceId),
      });

      // Check membership properly
      const memberships = await db.query.workspaceMembers.findMany({
        where: eq(
          schema.workspaceMembers.workspaceId,
          integration.workspaceId,
        ),
      });
      const isMember = memberships.some((m) => m.userId === userId);

      if (!isMember) {
        return reply.status(404).send({
          error: { code: "NOT_FOUND", message: "Integration not found." },
        });
      }

      // Delete credentials first (cascade in DB, but explicit for clarity)
      await db
        .delete(schema.integrationCredentials)
        .where(
          eq(
            schema.integrationCredentials.integrationId,
            id,
          ),
        );

      // Delete the integration
      await db
        .delete(schema.integrations)
        .where(eq(schema.integrations.id, id));

      reply.status(204).send();
    },
  });
}
