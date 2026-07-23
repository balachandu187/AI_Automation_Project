// ============================================================================
// FlowMind Workflow Engine — Drizzle DB Adapter
// ============================================================================
// Implements the ExecutorDB interface using Drizzle ORM.
// This bridges the engine's abstract DB interface to the real database.

import { eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1"; // eslint-disable-line
import * as schema from "../db/schema/index.js";
import type { ExecutorDB } from "./executor.js";
import type { DAGNode, DAGEdge, ExecutionStatus } from "./types.js";

// Minimal type for the Drizzle DB instance we need
type DrizzleDB = {
  update: (table: unknown) => {
    set: (data: Record<string, unknown>) => {
      where: (condition: unknown) => Promise<unknown>;
    };
  };
  insert: (table: unknown) => {
    values: (data: Record<string, unknown>) => {
      returning: () => Promise<unknown[]>;
    };
  };
  select: () => {
    from: (table: unknown) => {
      where: (condition: unknown) => Promise<unknown[]>;
    };
  };
};

/**
 * Create a Drizzle-based ExecutorDB from the DB client and schema.
 */
export function createDrizzleExecutorDB(db: DrizzleDB, s: typeof schema): ExecutorDB {
  return {
    async updateExecution(params) {
      await db
        .update(s.executions)
        .set({
          status: params.status,
          startedAt: params.startedAt ?? undefined,
          completedAt: params.completedAt ?? undefined,
          errorMessage: params.errorMessage ?? undefined,
        } as Record<string, unknown>)
        .where(eq(s.executions.id, params.id));
    },

    async insertStep(params) {
      const result = await db
        .insert(s.executionSteps)
        .values({
          executionId: params.executionId,
          nodeId: params.nodeId,
          status: params.status,
          input: params.input ?? null,
          output: params.output ?? null,
          error: params.error ?? null,
          retryCount: params.retryCount ?? 0,
          attemptMax: params.attemptMax ?? 3,
          startedAt: params.startedAt ?? new Date(),
          completedAt: params.completedAt ?? null,
        } as Record<string, unknown>)
        .returning();

      const row = result[0] as { id: string } | undefined;
      return { id: row?.id ?? "" };
    },

    async updateStep(params) {
      await db
        .update(s.executionSteps)
        .set({
          status: params.status,
          output: params.output ?? undefined,
          error: params.error ?? undefined,
          retryCount: params.retryCount ?? undefined,
          completedAt: params.completedAt ?? undefined,
        } as Record<string, unknown>)
        .where(eq(s.executionSteps.id, params.id));
    },

    async getWorkflowNodes(workflowId: string): Promise<DAGNode[]> {
      const rows = (await db
        .select()
        .from(s.workflowNodes)
        .where(eq(s.workflowNodes.workflowId, workflowId))) as Array<{
        id: string;
        type: string;
        label: string;
        config: Record<string, unknown>;
      }>;

      return rows.map((row) => ({
        id: row.id,
        type: row.type,
        label: row.label,
        config: row.config,
      }));
    },

    async getWorkflowEdges(workflowId: string): Promise<DAGEdge[]> {
      const rows = (await db
        .select()
        .from(s.workflowEdges)
        .where(eq(s.workflowEdges.workflowId, workflowId))) as Array<{
        id: string;
        sourceNodeId: string;
        targetNodeId: string;
        condition: Record<string, unknown> | null;
      }>;

      return rows.map((row) => ({
        id: row.id,
        sourceNodeId: row.sourceNodeId,
        targetNodeId: row.targetNodeId,
        condition: row.condition,
      }));
    },
  };
}
