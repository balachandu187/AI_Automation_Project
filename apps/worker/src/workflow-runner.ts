// ============================================================================
// FlowMind Worker — Workflow Runner
// ============================================================================
// Sets up the database connection and creates a WorkflowExecutor wired to
// the Drizzle ORM. This is the bridge between BullMQ jobs and the engine.

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { loadConfig } from "./config.js";
import * as schema from "../../api/src/db/schema/index.js";
import {
  WorkflowExecutor,
  createDrizzleExecutorDB,
  createDrizzleDeadLetterStore,
} from "../../api/src/engine/index.js";
import type { ExecutionJobData } from "../../api/src/engine/index.js";

const config = loadConfig();

const client = postgres(config.DATABASE_URL, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
});

const db = drizzle(client, { schema });

let _executor: WorkflowExecutor | null = null;

/**
 * Get or create the shared WorkflowExecutor instance.
 * The executor is stateless (all state lives in the DB), so a single
 * instance is safe to reuse across jobs.
 */
export async function createWorkflowExecutor(): Promise<WorkflowExecutor> {
  if (_executor) return _executor;

  const executorDB = createDrizzleExecutorDB(db as any, schema);
  const deadLetterStore = createDrizzleDeadLetterStore(db as any);

  _executor = new WorkflowExecutor(executorDB, deadLetterStore, {
    maxConcurrency: 5,
    timeoutMs: 900_000, // 15 minutes
    emitEvents: true,
    onStepEvent: (event) => {
      // Log step events; will emit via WebSocket in the future
      console.log(
        `[workflow-execution] ${event.type} node=${event.nodeId} status=${event.status}` +
          (event.durationMs != null ? ` duration=${event.durationMs}ms` : ""),
      );
    },
  });

  return _executor;
}

/**
 * Shutdown the database connection.
 */
export async function shutdownDB(): Promise<void> {
  await client.end();
}

export type { ExecutionJobData };
