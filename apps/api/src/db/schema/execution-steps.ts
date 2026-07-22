import { pgTable, uuid, varchar, text, timestamp, jsonb, integer, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { executions } from "./executions";
import { workflowNodes } from "./workflow-nodes";

/**
 * execution_steps — Individual node execution results within a workflow run.
 * Tracks input/output, errors, retries, and timing for each step.
 */
export const executionSteps = pgTable("execution_steps", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  executionId: uuid("execution_id")
    .notNull()
    .references(() => executions.id, { onDelete: "cascade" }),
  nodeId: uuid("node_id")
    .notNull()
    .references(() => workflowNodes.id),
  status: varchar("status", { length: 20 }).notNull().default("pending"),
  input: jsonb("input"),
  output: jsonb("output"),
  error: jsonb("error"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  retryCount: integer("retry_count").notNull().default(0),
  attemptMax: integer("attempt_max").notNull().default(3),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (table) => ({
  executionIdx: index("idx_es_execution").on(table.executionId),
  statusIdx: index("idx_es_status").on(table.status),
}));
