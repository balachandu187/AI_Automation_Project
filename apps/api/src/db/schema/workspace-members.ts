import { pgTable, uuid, varchar, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { workspaces } from "./workspaces";
import { users } from "./users";

/**
 * workspace_members — Maps users to workspaces with a role.
 * Roles: owner, admin, editor, viewer.
 */
export const workspaceMembers = pgTable("workspace_members", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  role: varchar("role", { length: 20 }).notNull().default("editor"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (table) => ({
  wsUserUnique: uniqueIndex("idx_wm_workspace_user").on(table.workspaceId, table.userId),
  wsIdx: index("idx_wm_workspace").on(table.workspaceId),
  userIdx: index("idx_wm_user").on(table.userId),
}));
