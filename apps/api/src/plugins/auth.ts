import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";

// Auth plugin stub — JWT verification will be implemented in the auth feature task.
// For now, this registers a decorator that downstream routes can use.

declare module "fastify" {
  interface FastifyRequest {
    userId?: string;
    workspaceId?: string;
  }
}

async function authPlugin(app: FastifyInstance): Promise<void> {
  app.decorateRequest("userId", undefined);
  app.decorateRequest("workspaceId", undefined);

  // Placeholder: extract user from Authorization header
  app.addHook("onRequest", async (request) => {
    const authHeader = request.headers.authorization;
    if (authHeader?.startsWith("Bearer ")) {
      // Token validation will be added when auth feature is implemented
      // request.userId = decoded.sub;
    }
  });
}

export default fp(authPlugin, { name: "auth" });
