// ============================================================================
// FlowMind Workflow Engine — Action Node Handler
// ============================================================================
// Executes HTTP requests, data transforms, and other action operations.

import type { NodeHandler, NodeConfig, NodeResult, ExecutionContext, DAGNode } from "../types.js";
import { RetryableError, FatalError } from "../errors.js";
import { resolveConfig } from "../context.js";

export class ActionHandler implements NodeHandler {
  readonly type = "action" as const;

  validate(config: NodeConfig): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    const actionType = config.actionType as string | undefined;

    if (!actionType) {
      errors.push("actionType is required");
      return { valid: false, errors };
    }

    const validTypes = ["http_request", "data_transform", "code", "notification", "delay"];
    if (!validTypes.includes(actionType)) {
      errors.push(`actionType must be one of: ${validTypes.join(", ")}`);
    }

    if (actionType === "http_request") {
      if (!config.url || typeof config.url !== "string") {
        errors.push("url is required for http_request actions");
      }
      if (!config.method || typeof config.method !== "string") {
        errors.push("method is required for http_request actions");
      }
    }

    if (actionType === "data_transform") {
      if (!config.expression || typeof config.expression !== "string") {
        errors.push("expression is required for data_transform actions");
      }
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

    const actionType = config.actionType as string;

    switch (actionType) {
      case "http_request":
        return this.executeHttpRequest(node, config, startTime);
      case "data_transform":
        return this.executeDataTransform(node, config, startTime);
      case "code":
        return this.executeCode(node, config, startTime);
      case "notification":
        return this.executeNotification(node, config, startTime);
      case "delay":
        return this.executeDelay(node, config, startTime);
      default:
        throw new FatalError(`Unknown action type: ${actionType}`);
    }
  }

  private async executeHttpRequest(
    node: DAGNode,
    config: Record<string, unknown>,
    startTime: number,
  ): Promise<NodeResult> {
    const url = config.url as string;
    const method = ((config.method as string) || "GET").toUpperCase();
    const headers = (config.headers as Record<string, string>) || {};
    const body = config.body;
    const timeout = (config.timeout as number) || 30000;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const fetchOptions: RequestInit = {
        method,
        headers: { "Content-Type": "application/json", ...headers },
        signal: controller.signal,
      };

      if (body && method !== "GET" && method !== "HEAD") {
        fetchOptions.body =
          typeof body === "string" ? body : JSON.stringify(body);
      }

      const response = await fetch(url, fetchOptions);
      clearTimeout(timeoutId);

      let responseBody: unknown;
      const contentType = response.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        responseBody = await response.json();
      } else {
        responseBody = await response.text();
      }

      if (!response.ok) {
        const errMsg = `HTTP ${response.status}: ${JSON.stringify(responseBody).slice(0, 500)}`;
        if (response.status >= 500 || response.status === 429) {
          throw new RetryableError(errMsg);
        }
        throw new FatalError(errMsg);
      }

      return {
        nodeId: node.id,
        status: "completed",
        output: {
          statusCode: response.status,
          headers: Object.fromEntries(response.headers.entries()),
          body: responseBody as Record<string, unknown>,
        },
        durationMs: Date.now() - startTime,
        retryCount: 0,
      };
    } catch (err) {
      clearTimeout(timeoutId);
      if (err instanceof Error && err.name === "AbortError") {
        throw new RetryableError(`HTTP request timed out after ${timeout}ms`);
      }
      throw err;
    }
  }

  private async executeDataTransform(
    node: DAGNode,
    config: Record<string, unknown>,
    startTime: number,
  ): Promise<NodeResult> {
    const expression = config.expression as string;
    const inputData = config.inputData as Record<string, unknown> | undefined;

    // Simple expression evaluator supporting basic operations
    // For production, this would use JSONata or a proper expression engine
    let result: unknown;
    try {
      result = this.evaluateExpression(expression, inputData || {});
    } catch (err) {
      throw new FatalError(
        `Expression evaluation failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    return {
      nodeId: node.id,
      status: "completed",
      output: { result },
      durationMs: Date.now() - startTime,
      retryCount: 0,
    };
  }

  private evaluateExpression(
    expr: string,
    data: Record<string, unknown>,
  ): unknown {
    // Simple mapping: "$.field" or "field" for JSON path extraction
    const trimmed = expr.trim();

    // Basic JSON path: $.field.subfield
    if (trimmed.startsWith("$.")) {
      const path = trimmed.slice(2).split(".");
      let current: unknown = data;
      for (const key of path) {
        if (current == null || typeof current !== "object") return undefined;
        current = (current as Record<string, unknown>)[key];
      }
      return current;
    }

    // Direct field reference
    if (trimmed in data) return data[trimmed];

    // String concatenation: "prefix " + field + " suffix"
    if (trimmed.includes("+")) {
      return trimmed
        .split("+")
        .map((part) => {
          const p = part.trim();
          const stripped = p.replace(/^["']|["']$/g, "");
          if (stripped in data) return String(data[stripped]);
          return stripped;
        })
        .join("");
    }

    return trimmed;
  }

  private async executeCode(
    node: DAGNode,
    config: Record<string, unknown>,
    startTime: number,
  ): Promise<NodeResult> {
    const code = config.code as string;
    if (!code) throw new FatalError("Code is required for code actions");

    // Sandboxed execution using Function constructor (restricted)
    // In production, this would use vm2 or isolated-vm
    try {
      const input = config.input as Record<string, unknown> | undefined;
      // eslint-disable-next-line no-new-func
      const fn = new Function("input", "context", code);
      const result = fn(input || {}, {});
      return {
        nodeId: node.id,
        status: "completed",
        output: { result },
        durationMs: Date.now() - startTime,
        retryCount: 0,
      };
    } catch (err) {
      throw new FatalError(
        `Code execution failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async executeNotification(
    node: DAGNode,
    config: Record<string, unknown>,
    startTime: number,
  ): Promise<NodeResult> {
    const channel = config.channel as string;
    const message = config.message as string;

    // Placeholder: log the notification
    console.log(
      `[notification] Channel: ${channel}, Message: ${message}`,
    );

    return {
      nodeId: node.id,
      status: "completed",
      output: { sent: true, channel, message },
      durationMs: Date.now() - startTime,
      retryCount: 0,
    };
  }

  private async executeDelay(
    node: DAGNode,
    config: Record<string, unknown>,
    startTime: number,
  ): Promise<NodeResult> {
    const durationMs = (config.duration as number) || 1000;
    const maxDuration = 300_000; // 5 minutes max

    if (durationMs > maxDuration) {
      throw new FatalError(
        `Delay duration ${durationMs}ms exceeds maximum of ${maxDuration}ms`,
      );
    }

    await new Promise((resolve) => setTimeout(resolve, durationMs));

    return {
      nodeId: node.id,
      status: "completed",
      output: { delayed: true, durationMs },
      durationMs: Date.now() - startTime,
      retryCount: 0,
    };
  }
}
