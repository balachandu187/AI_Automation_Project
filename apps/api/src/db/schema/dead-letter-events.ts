import { pgTable, uuid, text, timestamp, jsonb, integer, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { executions } from "./executions";
import { executionSteps } from "./execution-steps";
import { workflows } from "./workflows";
import { workflowNodes } from "./workflow-nodes";

/**
 * dead_letter_events — Events that exhausted all retry attempts.
 * Stores full execution context and error for manual inspection/replay.
 */
export const deadLetterEvents = pgTable("dead_letter_events", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  executionId: uuid("execution_id")
    .notNull()
    .references(() => executions.id, { onDelete: "cascade" }),
  stepId: uuid("step_id")
    .references(() => executionSteps.id, { onDelete: "set null" }),
  workflowId: uuid("workflow_id")
    .notNull()
    .references(() => workflows.id, { onDelete: "cascade" }),
  nodeId: uuid("node_id")
    .references(() => workflowNodes.id, { onDelete: "set null" }),
  payload: jsonb("payload").default(sql`'{}'::jsonb`),
  error: jsonb("error").notNull(),
  retryCount: integer("retry_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (table) => ({
  executionIdx: index("idx_dle_execution").on(table.executionId),
  workflowIdx: index("idx_dle_workflow").on(table.workflowId),
  createdIdx: index("idx_dle_created").on(table.createdAt),
}));
