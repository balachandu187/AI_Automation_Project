import { pgTable, uuid, varchar, real, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { workflows } from "./workflows";

/**
 * workflow_nodes — Individual nodes in the workflow DAG.
 * Each node has a type (trigger/action/condition/ai_agent/approval), config, and canvas position.
 */
export const workflowNodes = pgTable("workflow_nodes", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  workflowId: uuid("workflow_id")
    .notNull()
    .references(() => workflows.id, { onDelete: "cascade" }),
  type: varchar("type", { length: 50 }).notNull(),
  label: varchar("label", { length: 255 }).notNull(),
  config: jsonb("config").notNull().default(sql`'{}'::jsonb`),
  positionX: real("position_x").notNull().default(0),
  positionY: real("position_y").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (table) => ({
  workflowIdx: index("idx_wn_workflow").on(table.workflowId),
}));
