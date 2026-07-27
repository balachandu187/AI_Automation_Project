import { pgTable, uuid, varchar, boolean, timestamp, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./users";

/**
 * api_keys — Long-lived API keys for programmatic access.
 * Keys are hashed with SHA-256 before storage; only the last 4
 * characters of the raw key are stored for display purposes.
 */
export const apiKeys = pgTable("api_keys", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  keyHash: varchar("key_hash", { length: 128 }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  last4: varchar("last_4", { length: 4 }).notNull(),
  revoked: boolean("revoked").notNull().default(false),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (table) => ({
  userIdx: index("idx_ak_user").on(table.userId),
  keyHashIdx: index("idx_ak_key_hash").on(table.keyHash),
}));
