import { pgTable, uuid, varchar, timestamp, jsonb, uniqueIndex, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { workflows } from "./workflows";
import { workflowNodes } from "./workflow-nodes";

/**
 * workflow_edges — Directed connections between workflow nodes.
 * Optional condition JSONB for branching logic.
 */
export const workflowEdges = pgTable("workflow_edges", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  workflowId: uuid("workflow_id")
    .notNull()
    .references(() => workflows.id, { onDelete: "cascade" }),
  sourceNodeId: uuid("source_node_id")
    .notNull()
    .references(() => workflowNodes.id, { onDelete: "cascade" }),
  targetNodeId: uuid("target_node_id")
    .notNull()
    .references(() => workflowNodes.id, { onDelete: "cascade" }),
  condition: jsonb("condition"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (table) => ({
  workflowIdx: index("idx_we_workflow").on(table.workflowId),
  sourceTargetUnique: uniqueIndex("idx_we_source_target").on(table.workflowId, table.sourceNodeId, table.targetNodeId),
}));
