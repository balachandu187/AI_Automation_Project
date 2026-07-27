// ============================================================================
// FlowMind Auth — RBAC Middleware
// ============================================================================
// Role-based access control for workspace-scoped endpoints.
// Must run after requireAuth (which sets request.userId).
import type { FastifyRequest, FastifyReply } from "fastify";
import { db, schema } from "../db/index.js";
import { eq, and } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Role hierarchy (ordered least → most privileged)
// ---------------------------------------------------------------------------
export const Roles = {
  VIEWER: "viewer",
  EDITOR: "editor",
  ADMIN: "admin",
  OWNER: "owner",
} as const;

export type Role = (typeof Roles)[keyof typeof Roles];

const ROLE_WEIGHT: Record<Role, number> = {
  viewer: 0,
  editor: 1,
  admin: 2,
  owner: 3,
};

/**
 * requireRole — middleware factory.
 *
 * Checks that the authenticated user is a member of the workspace
 * (identified by :wsId route param) AND has one of the required roles.
 *
 * Usage:
 *   app.get("/:wsId/workflows", {
 *     preHandler: [requireAuth, requireRole("editor", "admin", "owner")]
 *   }, handler);
 */
export function requireRole(...roles: Role[]) {
  const minWeight = Math.min(...roles.map((r) => ROLE_WEIGHT[r] ?? -1));

  return async function checkRole(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const params = request.params as Record<string, string> | undefined;
    const wsId = params?.wsId;
    const userId = request.userId;

    if (!wsId || !userId) {
      return reply.status(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: "Workspace ID and authentication are required.",
        },
      });
    }

    const membership = await db.query.workspaceMembers.findFirst({
      where: and(
        eq(schema.workspaceMembers.workspaceId, wsId),
        eq(schema.workspaceMembers.userId, userId),
      ),
    });

    if (!membership) {
      return reply.status(403).send({
        error: {
          code: "FORBIDDEN",
          message: "You are not a member of this workspace.",
        },
      });
    }

    const userWeight = ROLE_WEIGHT[membership.role as Role] ?? -1;

    if (userWeight < minWeight) {
      return reply.status(403).send({
        error: {
          code: "FORBIDDEN",
          message: `This action requires one of the following roles: ${roles.join(", ")}.`,
        },
      });
    }

    // Attach workspace to request for downstream handlers
    request.workspaceId = wsId;
  };
}
