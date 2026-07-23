// ============================================================================
// FlowMind Workflow Engine — Trigger Node Handler
// ============================================================================
// Validates trigger payload and extracts input for downstream nodes.

import type { NodeHandler, NodeConfig, NodeResult, ExecutionContext, DAGNode } from "../types.js";
import { ValidationError } from "../errors.js";

export class TriggerHandler implements NodeHandler {
  readonly type = "trigger" as const;

  /**
   * Validate the trigger node configuration.
   * Trigger nodes accept the incoming payload schema definition.
   */
  validate(config: NodeConfig): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!config.triggerType || typeof config.triggerType !== "string") {
      errors.push("triggerType is required and must be a string");
    }

    const validTypes = ["manual", "webhook", "schedule", "event", "workflow_call"];
    if (config.triggerType && !validTypes.includes(config.triggerType as string)) {
      errors.push(`triggerType must be one of: ${validTypes.join(", ")}`);
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Execute the trigger node.
   * Extracts the trigger payload and makes it available as output.
   */
  async execute(
    context: ExecutionContext,
    node: DAGNode,
  ): Promise<NodeResult> {
    const startTime = Date.now();
    const config = node.config as Record<string, unknown>;

    // Validate input schema if defined
    const inputSchema = config.inputSchema as
      | Record<string, unknown>
      | undefined;
    if (inputSchema) {
      const validationErrors = this.validatePayload(
        context.triggerPayload,
        inputSchema,
      );
      if (validationErrors.length > 0) {
        throw new ValidationError(
          `Trigger payload validation failed for node ${node.id}`,
          validationErrors,
        );
      }
    }

    // Extract mapped fields from the input mapping config
    const inputMapping = config.inputMapping as
      | Record<string, string>
      | undefined;

    const output: Record<string, unknown> = {};

    if (inputMapping) {
      for (const [outputField, sourcePath] of Object.entries(inputMapping)) {
        output[outputField] = this.resolveJsonPath(
          context.triggerPayload,
          sourcePath,
        );
      }
    } else {
      // Pass through the full trigger payload
      Object.assign(output, context.triggerPayload);
    }

    return {
      nodeId: node.id,
      status: "completed",
      output,
      durationMs: Date.now() - startTime,
      retryCount: 0,
    };
  }

  /**
   * Validate a payload against a simple JSON schema.
   */
  private validatePayload(
    payload: Record<string, unknown>,
    schema: Record<string, unknown>,
  ): string[] {
    const errors: string[] = [];
    const required = schema.required as string[] | undefined;
    const properties = schema.properties as
      | Record<string, Record<string, unknown>>
      | undefined;

    if (required && properties) {
      for (const field of required) {
        if (!(field in payload) || payload[field] == null) {
          errors.push(`Required field "${field}" is missing`);
        }
      }
    }

    return errors;
  }

  /**
   * Resolve a simple JSON path like "data.email" or "body.name".
   */
  private resolveJsonPath(
    obj: Record<string, unknown>,
    path: string,
  ): unknown {
    const parts = path.split(".");
    let current: unknown = obj;

    for (const part of parts) {
      if (current == null || typeof current !== "object") return undefined;
      current = (current as Record<string, unknown>)[part];
    }

    return current;
  }
}
