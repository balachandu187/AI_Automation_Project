import { pgTable, uuid, varchar, text, timestamp, jsonb, integer, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { workflows } from "./workflows";
import { workflowVersions } from "./workflow-versions";

/**
 * executions — Records of workflow runs.
 * Links to the workflow and the specific version that was executed.
 */
export const executions = pgTable("executions", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  workflowId: uuid("workflow_id")
    .notNull()
    .references(() => workflows.id, { onDelete: "cascade" }),
  workflowVersionId: uuid("workflow_version_id")
    .notNull()
    .references(() => workflowVersions.id),
  status: varchar("status", { length: 20 }).notNull().default("pending"),
  triggerType: varchar("trigger_type", { length: 50 }).notNull(),
  triggerPayload: jsonb("trigger_payload"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (table) => ({
  workflowIdx: index("idx_exec_workflow").on(table.workflowId),
  statusIdx: index("idx_exec_status").on(table.status),
  startedIdx: index("idx_exec_started").on(table.startedAt),
  createdIdx: index("idx_exec_created").on(table.createdAt),
}));
