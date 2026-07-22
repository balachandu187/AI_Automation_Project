import Fastify from "fastify";
import { loadConfig } from "./config.js";
import { registerCors } from "./plugins/cors.js";
import { registerRateLimit } from "./plugins/rateLimit.js";
import { healthRoutes } from "./routes/health.js";

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

  // Register plugins
  await registerCors(app);
  await registerRateLimit(app);

  // Register routes
  await app.register(healthRoutes, { prefix: "/" });

  // Start server
  try {
    await app.listen({ host: "0.0.0.0", port: config.API_PORT });
    console.log(`🚀 FlowMind API running on port ${config.API_PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main();
