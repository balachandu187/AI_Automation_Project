import { pgTable, uuid, varchar, boolean, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { workspaces } from "./workspaces";

/**
 * integrations — Third-party service connections configured per workspace.
 * Providers include slack, gmail, google_drive, salesforce, etc.
 */
export const integrations = pgTable("integrations", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  provider: varchar("provider", { length: 50 }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  isBuiltin: boolean("is_builtin").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (table) => ({
  workspaceIdx: index("idx_int_workspace").on(table.workspaceId),
}));
