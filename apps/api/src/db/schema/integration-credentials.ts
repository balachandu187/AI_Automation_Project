import { pgTable, uuid, varchar, text, timestamp, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { integrations } from "./integrations";

/**
 * integration_credentials — Encrypted authentication tokens for integrations.
 * Credentials are AES-256-GCM encrypted before storage. Supports OAuth tokens and API keys.
 */
export const integrationCredentials = pgTable("integration_credentials", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  integrationId: uuid("integration_id")
    .notNull()
    .references(() => integrations.id, { onDelete: "cascade" }),
  credentialType: varchar("credential_type", { length: 30 }).notNull(),
  encryptedCredentials: text("encrypted_credentials").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (table) => ({
  integrationIdx: index("idx_ic_integration").on(table.integrationId),
}));
