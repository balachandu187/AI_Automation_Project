import { pgTable, uuid, varchar, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { workspaces } from "./workspaces";
import { users } from "./users";

/**
 * workflows — Automation workflow definitions.
 * Each workflow belongs to a workspace and is versioned via workflow_versions.
 */
export const workflows = pgTable("workflows", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  status: varchar("status", { length: 20 }).notNull().default("draft"),
  triggerType: varchar("trigger_type", { length: 50 }).notNull().default("manual"),
  triggerConfig: jsonb("trigger_config").default(sql`'{}'::jsonb`),
  createdBy: uuid("created_by")
    .notNull()
    .references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (table) => ({
  workspaceIdx: index("idx_workflows_workspace").on(table.workspaceId),
  statusIdx: index("idx_workflows_status").on(table.status),
}));
