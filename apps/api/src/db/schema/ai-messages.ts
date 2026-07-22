import { pgTable, uuid, varchar, text, timestamp, jsonb, integer, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { aiConversations } from "./ai-conversations";

/**
 * ai_messages — Individual messages within an AI conversation.
 * Supports system, user, assistant, and tool roles. Tracks tool calls and token counts.
 */
export const aiMessages = pgTable("ai_messages", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  conversationId: uuid("conversation_id")
    .notNull()
    .references(() => aiConversations.id, { onDelete: "cascade" }),
  role: varchar("role", { length: 20 }).notNull(),
  content: text("content"),
  toolCalls: jsonb("tool_calls"),
  toolCallId: varchar("tool_call_id", { length: 255 }),
  tokenCount: integer("token_count"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (table) => ({
  conversationIdx: index("idx_aim_conversation").on(table.conversationId),
  createdIdx: index("idx_aim_created").on(table.createdAt),
}));
