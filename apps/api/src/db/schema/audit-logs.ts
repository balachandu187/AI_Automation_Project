import { pgTable, uuid, varchar, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizations } from "./organizations";
import { workspaces } from "./workspaces";
import { users } from "./users";

/**
 * audit_logs — Immutable append-only audit trail for compliance and observability.
 * Logs every mutating action: workflow edits, executions, user invites, credential changes.
 * No UPDATE or DELETE operations allowed on this table.
 */
export const auditLogs = pgTable("audit_logs", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id),
  workspaceId: uuid("workspace_id")
    .references(() => workspaces.id, { onDelete: "set null" }),
  userId: uuid("user_id")
    .references(() => users.id, { onDelete: "set null" }),
  action: varchar("action", { length: 100 }).notNull(),
  resourceType: varchar("resource_type", { length: 50 }).notNull(),
  resourceId: uuid("resource_id"),
  details: jsonb("details"),
  ipAddress: varchar("ip_address", { length: 45 }),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (table) => ({
  orgTimeIdx: index("idx_al_org_time").on(table.orgId, table.createdAt),
  resourceIdx: index("idx_al_resource").on(table.resourceType, table.resourceId),
  actorIdx: index("idx_al_actor").on(table.userId),
  actionIdx: index("idx_al_action").on(table.action),
}));
