import Fastify from "fastify";
import { loadConfig } from "./config.js";
import { registerCors } from "./plugins/cors.js";
import { registerRateLimit } from "./plugins/rateLimit.js";
import { healthRoutes } from "./routes/health.js";
import { workspaceRoutes } from "./routes/workspaces.js";
import { workflowRoutes } from "./routes/workflows.js";
import { nodeRoutes } from "./routes/nodes.js";
import { edgeRoutes } from "./routes/edges.js";
import { executionRoutes } from "./routes/executions.js";
import { integrationRoutes } from "./routes/integrations.js";
import {
  attachRequestId,
  errorHandler,
} from "./routes/middleware.js";

async function main(): Promise<void> {
  const config = loadConfig();

  const app = Fastify({
    logger: {
      level: config.NODE_ENV === "production" ? "info" : "debug",
      transport:
        config.NODE_ENV === "development"
          ? { target: "pino-pretty", options: { colorize: true } }
          : undefined,
    },
    trustProxy: true,
  });

  // ---- Global hooks ----
  // Attach request ID to every response
  app.addHook("onRequest", attachRequestId);

  // Global error handler for consistent error responses
  app.setErrorHandler(errorHandler);

  // ---- Plugins ----
  await registerCors(app);
  await registerRateLimit(app);

  // ---- Route registration (all under /api/v1) ----
  await app.register(healthRoutes, { prefix: "/" });
  await app.register(workspaceRoutes, { prefix: "/api/v1/workspaces" });
  await app.register(workflowRoutes, { prefix: "/api/v1" });
  await app.register(nodeRoutes, { prefix: "/api/v1" });
  await app.register(edgeRoutes, { prefix: "/api/v1" });
  await app.register(executionRoutes, { prefix: "/api/v1" });
  await app.register(integrationRoutes, { prefix: "/api/v1" });

  // ---- Start server ----
  try {
    await app.listen({ host: "0.0.0.0", port: config.API_PORT });
    console.log(`🚀 FlowMind API running on port ${config.API_PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main();
