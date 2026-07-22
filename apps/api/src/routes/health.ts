import type { FastifyInstance } from "fastify";

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/health", {
    schema: {
      response: {
        200: {
          type: "object",
          properties: {
            status: { type: "string" },
            uptime: { type: "number" },
            timestamp: { type: "string" },
          },
        },
      },
    },
    handler: async () => {
      return {
        status: "ok",
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
      };
    },
  });
}
