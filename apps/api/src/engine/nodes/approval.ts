// ============================================================================
// FlowMind Workflow Engine — Approval Node Handler
// ============================================================================
// Creates a human-in-the-loop approval step that pauses workflow execution.
// The workflow resumes when the approver takes action via the API.

import type { NodeHandler, NodeConfig, NodeResult, ExecutionContext, DAGNode } from "../types.js";
import { ApprovalRequiredError } from "../errors.js";
import { resolveConfig } from "../context.js";

export class ApprovalHandler implements NodeHandler {
  readonly type = "approval" as const;

  validate(config: NodeConfig): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!config.message || typeof config.message !== "string") {
      errors.push("message is required (what the approver sees)");
    }

    const approvers = config.approvers as unknown[] | undefined;
    if (!approvers || (Array.isArray(approvers) && approvers.length === 0)) {
      errors.push("at least one approver is required");
    }

    return { valid: errors.length === 0, errors };
  }

  async execute(
    context: ExecutionContext,
    node: DAGNode,
  ): Promise<NodeResult> {
    const startTime = Date.now();
    const config = resolveConfig(
      node.config as Record<string, unknown>,
      context,
    ) as Record<string, unknown>;

    const message = config.message as string;
    const approvers = (config.approvers as unknown[]) || [];
    const timeoutMs = (config.timeoutMs as number) || 3600000; // default 1 hour
    const timeoutBehavior = (config.timeoutBehavior as string) || "reject";

    // Build approval data
    const approvalData: Record<string, unknown> = {
      nodeId: node.id,
      nodeLabel: node.label,
      executionId: context.executionId,
      workflowId: context.workflowId,
      message,
      approvers,
      timeoutMs,
      timeoutBehavior,
      // Include upstream outputs so the approver has context
      availableData: Object.fromEntries(context.nodeOutputs),
      requestedAt: new Date().toISOString(),
    };

    // This pauses execution — the result will be updated when the approver acts
    // via the API endpoint POST /api/executions/:id/approve
    throw new ApprovalRequiredError(
      `Approval required: ${message}`,
      node.id,
      approvalData,
    );
  }
}
