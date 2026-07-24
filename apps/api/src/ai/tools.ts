// ============================================================================
// FlowMind AI — Tool Calling Framework
// ============================================================================
// Define tools as TypeScript functions with JSON Schema parameter definitions.
// Provides a registry for tools, input validation, execution, and result
// formatting for the LLM conversation loop.

import type { ToolDefinition } from "./providers/types.js";
import { FatalError } from "../engine/errors.js";

// ============================================================================
// Types
// ============================================================================

/** A tool's parameter definition (subset of JSON Schema) */
export interface ToolParamDef {
  type: "string" | "number" | "integer" | "boolean" | "object" | "array";
  description?: string;
  required?: boolean;
  default?: unknown;
  enum?: unknown[];
  items?: ToolParamDef; // for arrays
  properties?: Record<string, ToolParamDef>; // for objects
}

/** A registered tool that can be called by an AI agent */
export interface RegisteredTool {
  /** Unique name (used in LLM function calling) */
  name: string;
  /** Human-readable description for the LLM */
  description: string;
  /** JSON Schema for parameters */
  parameters: Record<string, unknown>;
  /** The actual implementation */
  execute: (args: Record<string, unknown>, context?: ToolExecutionContext) => Promise<ToolResult>;
  /** Category for organization */
  category?: string;
  /** Whether this tool requires human approval before execution */
  requiresApproval?: boolean;
  /** Timeout in ms (default: 30000) */
  timeoutMs?: number;
}

/** Context passed to tool executions */
export interface ToolExecutionContext {
  workspaceId?: string;
  workflowId?: string;
  executionId?: string;
  userId?: string;
  /** Additional arbitrary context */
  [key: string]: unknown;
}

/** Result from a tool execution */
export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
  /** Arbitrary metadata */
  metadata?: Record<string, unknown>;
}

// ============================================================================
// Tool Registry
// ============================================================================

export class ToolRegistry {
  private tools = new Map<string, RegisteredTool>();

  /**
   * Register a tool.
   */
  register(tool: RegisteredTool): void {
    if (this.tools.has(tool.name)) {
      throw new FatalError(`Tool already registered: ${tool.name}`);
    }
    this.tools.set(tool.name, tool);
  }

  /**
   * Register multiple tools at once.
   */
  registerAll(tools: RegisteredTool[]): void {
    for (const tool of tools) {
      this.register(tool);
    }
  }

  /**
   * Unregister a tool.
   */
  unregister(name: string): boolean {
    return this.tools.delete(name);
  }

  /**
   * Get a tool by name.
   */
  get(name: string): RegisteredTool | undefined {
    return this.tools.get(name);
  }

  /**
   * Check if a tool is registered.
   */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * List all registered tools.
   */
  list(category?: string): RegisteredTool[] {
    const all = Array.from(this.tools.values());
    if (category) {
      return all.filter((t) => t.category === category);
    }
    return all;
  }

  /**
   * Get all tools as LLM ToolDefinitions.
   */
  getDefinitions(filter?: (tool: RegisteredTool) => boolean): ToolDefinition[] {
    const tools = filter ? this.list().filter(filter) : this.list();
    return tools.map((t) => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));
  }

  /**
   * Execute a tool call and return the result.
   */
  async execute(
    name: string,
    args: string | Record<string, unknown>,
    context?: ToolExecutionContext,
  ): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return { success: false, error: `Unknown tool: ${name}` };
    }

    // Parse arguments if they come as a JSON string (from LLM)
    let parsedArgs: Record<string, unknown>;
    if (typeof args === "string") {
      try {
        parsedArgs = JSON.parse(args);
      } catch {
        return { success: false, error: `Invalid JSON arguments for tool ${name}` };
      }
    } else {
      parsedArgs = args;
    }

    // Validate arguments
    const validation = validateToolArgs(tool, parsedArgs);
    if (!validation.valid) {
      return { success: false, error: `Invalid arguments: ${validation.errors.join(", ")}` };
    }

    // Execute with timeout
    const timeout = tool.timeoutMs ?? 30_000;
    try {
      const result = await Promise.race([
        tool.execute(parsedArgs, context),
        new Promise<ToolResult>((_, reject) =>
          setTimeout(
            () => reject(new Error(`Tool ${name} timed out after ${timeout}ms`)),
            timeout,
          ),
        ),
      ]);

      return result;
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}

// ============================================================================
// Argument Validation
// ============================================================================

function validateToolArgs(
  tool: RegisteredTool,
  args: Record<string, unknown>,
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const params = tool.parameters as {
    type?: string;
    properties?: Record<string, ToolParamDef>;
    required?: string[];
  };

  if (params.type !== "object" || !params.properties) {
    // No schema to validate against — accept anything
    return { valid: true, errors: [] };
  }

  const requiredFields = new Set(params.required || []);

  for (const [key, def] of Object.entries(params.properties)) {
    const value = args[key];

    if (requiredFields.has(key) && (value === undefined || value === null)) {
      errors.push(`Missing required field: ${key}`);
      continue;
    }

    if (value === undefined || value === null) continue;

    // Type check
    const expectedType = def.type;
    if (!checkType(value, expectedType)) {
      errors.push(`Field "${key}" expected ${expectedType}, got ${typeof value}`);
    }
  }

  return { valid: errors.length === 0, errors };
}

function checkType(value: unknown, expected: string): boolean {
  switch (expected) {
    case "string": return typeof value === "string";
    case "number":
    case "integer":
      return typeof value === "number" && (expected !== "integer" || Number.isInteger(value));
    case "boolean": return typeof value === "boolean";
    case "object": return typeof value === "object" && value !== null && !Array.isArray(value);
    case "array": return Array.isArray(value);
    default: return true;
  }
}

// ============================================================================
// Built-in Tools
// ============================================================================

/**
 * Create the default HTTP request tool.
 */
export function createHttpRequestTool(): RegisteredTool {
  return {
    name: "http_request",
    description: "Make an HTTP request to an external API",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "The URL to request" },
        method: {
          type: "string",
          enum: ["GET", "POST", "PUT", "PATCH", "DELETE"],
          description: "HTTP method",
        },
        headers: {
          type: "object",
          description: "Request headers (key-value pairs)",
        },
        body: { type: "string", description: "Request body (JSON string)" },
      },
      required: ["url"],
    },
    async execute(args): Promise<ToolResult> {
      try {
        const url = args.url as string;
        const method = (args.method as string) || "GET";
        const headers = (args.headers as Record<string, string>) || {};
        const body = args.body as string | undefined;

        const response = await fetch(url, {
          method,
          headers: { "Content-Type": "application/json", ...headers },
          body,
        });

        const text = await response.text();
        let data: unknown = text;
        try {
          data = JSON.parse(text);
        } catch { /* keep as text */ }

        return {
          success: response.ok,
          data,
          metadata: {
            status: response.status,
            statusText: response.statusText,
          },
        };
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
    category: "integration",
  };
}

/**
 * Create a Slack message sending tool.
 */
export function createSlackTool(): RegisteredTool {
  return {
    name: "send_slack_message",
    description: "Send a message to a Slack channel",
    parameters: {
      type: "object",
      properties: {
        channel: { type: "string", description: "Slack channel ID or name" },
        text: { type: "string", description: "Message text to send" },
        thread_ts: { type: "string", description: "Thread timestamp to reply in a thread (optional)" },
      },
      required: ["channel", "text"],
    },
    async execute(args, context): Promise<ToolResult> {
      // In production, this would use the Slack Web API via the integrations module.
      // For now, log the action and return success.
      console.log(
        `[slack-tool] Would send to #${args.channel}: ${(args.text as string).slice(0, 100)}...`,
      );

      return {
        success: true,
        data: {
          channel: args.channel,
          text: args.text,
          sent: false,
          note: "Slack integration not fully configured — message logged only",
        },
      };
    },
    category: "integration",
    requiresApproval: true,
  };
}

/**
 * Create an email sending tool.
 */
export function createEmailTool(): RegisteredTool {
  return {
    name: "send_email",
    description: "Send an email",
    parameters: {
      type: "object",
      properties: {
        to: { type: "string", description: "Recipient email address" },
        subject: { type: "string", description: "Email subject" },
        body: { type: "string", description: "Email body (plain text or HTML)" },
        cc: { type: "string", description: "CC recipients (comma-separated, optional)" },
      },
      required: ["to", "subject", "body"],
    },
    async execute(args): Promise<ToolResult> {
      console.log(
        `[email-tool] Would email ${args.to}: ${(args.subject as string).slice(0, 80)}`,
      );

      return {
        success: true,
        data: {
          to: args.to,
          subject: args.subject,
          sent: false,
          note: "Email integration not fully configured — message logged only",
        },
      };
    },
    category: "integration",
    requiresApproval: true,
  };
}

/**
 * Create a webhook trigger tool.
 */
export function createWebhookTool(): RegisteredTool {
  return {
    name: "call_webhook",
    description: "Trigger an external webhook",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "Webhook URL" },
        payload: { type: "object", description: "JSON payload to send" },
      },
      required: ["url"],
    },
    async execute(args): Promise<ToolResult> {
      try {
        const response = await fetch(args.url as string, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(args.payload || {}),
        });
        return {
          success: response.ok,
          data: await response.text(),
          metadata: { status: response.status },
        };
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
    category: "integration",
  };
}

/**
 * Create a database query tool.
 */
export function createDatabaseQueryTool(): RegisteredTool {
  return {
    name: "query_database",
    description: "Execute a read-only SQL query against the workspace database",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "SQL SELECT query to execute" },
      },
      required: ["query"],
    },
    async execute(args): Promise<ToolResult> {
      const query = args.query as string;
      const upperQuery = query.trim().toUpperCase();

      // Security: only allow SELECT statements
      if (
        !upperQuery.startsWith("SELECT") ||
        upperQuery.includes("INSERT") ||
        upperQuery.includes("UPDATE") ||
        upperQuery.includes("DELETE") ||
        upperQuery.includes("DROP") ||
        upperQuery.includes("ALTER")
      ) {
        return {
          success: false,
          error: "Only SELECT queries are allowed for safety",
        };
      }

      // In production, this would execute against the actual DB
      return {
        success: true,
        data: {
          note: "Database query tool — execution requires full DB integration",
          query,
        },
      };
    },
    category: "data",
  };
}

/**
 * Create a human escalation tool (requests approval or clarification).
 */
export function createHumanEscalationTool(): RegisteredTool {
  return {
    name: "request_human_approval",
    description: "Request human approval or clarification before proceeding",
    parameters: {
      type: "object",
      properties: {
        question: { type: "string", description: "What needs approval or clarification" },
        context: { type: "string", description: "Additional context for the human reviewer" },
        options: {
          type: "array",
          items: { type: "string" },
          description: "Options for the human to choose from (optional)",
        },
      },
      required: ["question"],
    },
    async execute(args): Promise<ToolResult> {
      return {
        success: true,
        data: {
          question: args.question,
          context: args.context,
          status: "pending",
          note: "Human approval requested — workflow will pause until response received",
        },
      };
    },
    category: "human",
    requiresApproval: false, // This IS the approval request
  };
}

/**
 * Create the default tool registry with built-in tools.
 */
export function createDefaultToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.registerAll([
    createHttpRequestTool(),
    createSlackTool(),
    createEmailTool(),
    createWebhookTool(),
    createDatabaseQueryTool(),
    createHumanEscalationTool(),
  ]);
  return registry;
}
