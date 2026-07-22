import { pgTable, uuid, integer, text, timestamp, jsonb, uniqueIndex, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { workflows } from "./workflows";
import { users } from "./users";

/**
 * workflow_versions — Immutable snapshots of workflow definitions.
 * Each version captures the full DAG (nodes + edges) as a JSONB snapshot.
 */
export const workflowVersions = pgTable("workflow_versions", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  workflowId: uuid("workflow_id")
    .notNull()
    .references(() => workflows.id, { onDelete: "cascade" }),
  versionNumber: integer("version_number").notNull(),
  snapshot: jsonb("snapshot").notNull(),
  changelog: text("changelog"),
  createdBy: uuid("created_by")
    .notNull()
    .references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (table) => ({
  workflowVersionUnique: uniqueIndex("idx_wv_workflow_version").on(table.workflowId, table.versionNumber),
  workflowIdx: index("idx_wv_workflow").on(table.workflowId),
}));
