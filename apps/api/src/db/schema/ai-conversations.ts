import { pgTable, uuid, varchar, text, timestamp, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { workflows } from "./workflows";
import { executions } from "./executions";

/**
 * ai_conversations — AI chat sessions tied to workflow executions.
 * Records model used and conversation lifecycle for AI agent nodes.
 */
export const aiConversations = pgTable("ai_conversations", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  workflowId: uuid("workflow_id")
    .notNull()
    .references(() => workflows.id),
  executionId: uuid("execution_id")
    .references(() => executions.id, { onDelete: "set null" }),
  model: varchar("model", { length: 100 }).notNull(),
  systemPrompt: text("system_prompt"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (table) => ({
  executionIdx: index("idx_aic_execution").on(table.executionId),
  workflowIdx: index("idx_aic_workflow").on(table.workflowId),
}));
