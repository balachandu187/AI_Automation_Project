import { pgTable, uuid, varchar, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizations } from "./organizations";
import { users } from "./users";

/**
 * organization_members — Maps users to organizations with a role.
 * Roles: owner, admin, member.
 */
export const organizationMembers = pgTable("organization_members", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  role: varchar("role", { length: 20 }).notNull().default("member"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (table) => ({
  orgUserUnique: uniqueIndex("idx_om_org_user").on(table.orgId, table.userId),
}));
