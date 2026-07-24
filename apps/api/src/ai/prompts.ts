// ============================================================================
// FlowMind AI — Prompt Management
// ============================================================================
// Template-based prompt system with variable interpolation, versioning,
// and testing utilities.

import { FatalError } from "../engine/errors.js";

// ============================================================================
// Types
// ============================================================================

export interface PromptVariable {
  name: string;
  type: "string" | "number" | "boolean" | "object" | "array";
  description?: string;
  required: boolean;
  default?: unknown;
}

export interface PromptTemplate {
  id: string;
  name: string;
  description?: string;
  version: number;
  /** System prompt (sets AI behavior) */
  systemPrompt: string;
  /** User prompt (contains the task) */
  userPrompt: string;
  /** Variable definitions */
  variables: PromptVariable[];
  /** Category for organization */
  category?: string;
  /** Tags */
  tags: string[];
  /** When this version was created */
  createdBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

/** A prompt version stored in the history */
export interface PromptVersion {
  promptId: string;
  version: number;
  systemPrompt: string;
  userPrompt: string;
  variables: PromptVariable[];
  createdAt: Date;
  createdBy?: string;
}

// ============================================================================
// Prompt Manager
// ============================================================================

export class PromptManager {
  private templates = new Map<string, PromptTemplate>();
  private history = new Map<string, PromptVersion[]>();

  /**
   * Register a new prompt template.
   */
  register(template: Omit<PromptTemplate, "version" | "createdAt" | "updatedAt">): PromptTemplate {
    const existing = this.templates.get(template.id);
    if (existing) {
      // Archive current version
      this.archiveVersion(existing);
    }

    const version = existing ? existing.version + 1 : 1;

    const prompt: PromptTemplate = {
      ...template,
      version,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.templates.set(template.id, prompt);

    // Add to history
    if (!this.history.has(template.id)) {
      this.history.set(template.id, []);
    }
    this.history.get(template.id)!.push({
      promptId: template.id,
      version,
      systemPrompt: template.systemPrompt,
      userPrompt: template.userPrompt,
      variables: [...template.variables],
      createdAt: new Date(),
      createdBy: template.createdBy,
    });

    return prompt;
  }

  /**
   * Get a prompt template by ID.
   */
  get(id: string): PromptTemplate | undefined {
    return this.templates.get(id);
  }

  /**
   * Get a specific version of a prompt.
   */
  getVersion(promptId: string, version: number): PromptVersion | undefined {
    const versions = this.history.get(promptId);
    return versions?.find((v) => v.version === version);
  }

  /**
   * Get all versions of a prompt.
   */
  getHistory(promptId: string): PromptVersion[] {
    return this.history.get(promptId) || [];
  }

  /**
   * Rollback to a specific version.
   */
  rollback(promptId: string, version: number): PromptTemplate {
    const targetVersion = this.getVersion(promptId, version);
    if (!targetVersion) {
      throw new FatalError(
        `Version ${version} not found for prompt ${promptId}`
      );
    }

    const current = this.templates.get(promptId);
    if (!current) {
      throw new FatalError(`Prompt ${promptId} not found`);
    }

    return this.register({
      id: promptId,
      name: current.name,
      description: current.description,
      systemPrompt: targetVersion.systemPrompt,
      userPrompt: targetVersion.userPrompt,
      variables: targetVersion.variables,
      category: current.category,
      tags: current.tags,
      createdBy: current.createdBy,
    });
  }

  /**
   * Delete a prompt template.
   */
  delete(id: string): boolean {
    this.history.delete(id);
    return this.templates.delete(id);
  }

  /**
   * List all registered prompts.
   */
  list(category?: string): PromptTemplate[] {
    const all = Array.from(this.templates.values());
    if (category) {
      return all.filter((p) => p.category === category);
    }
    return all;
  }

  /**
   * Render a prompt by interpolating variables.
   * Supports {{variable}} syntax.
   */
  render(
    template: PromptTemplate,
    variables: Record<string, unknown>,
  ): { system: string; user: string } {
    // Validate required variables
    const missing: string[] = [];
    for (const v of template.variables) {
      if (v.required && !(v.name in variables)) {
        missing.push(v.name);
      }
    }
    if (missing.length > 0) {
      throw new FatalError(
        `Missing required variables: ${missing.join(", ")}`
      );
    }

    const system = interpolate(template.systemPrompt, variables, template.variables);
    const user = interpolate(template.userPrompt, variables, template.variables);

    return { system, user };
  }

  /**
   * Build messages array from a prompt template + variables.
   */
  buildMessages(
    template: PromptTemplate,
    variables: Record<string, unknown>,
  ): Array<{ role: "system" | "user"; content: string }> {
    const { system, user } = this.render(template, variables);
    const messages: Array<{ role: "system" | "user"; content: string }> = [];
    if (system.trim()) {
      messages.push({ role: "system", content: system });
    }
    if (user.trim()) {
      messages.push({ role: "user", content: user });
    }
    return messages;
  }

  private archiveVersion(template: PromptTemplate): void {
    if (!this.history.has(template.id)) {
      this.history.set(template.id, []);
    }
    this.history.get(template.id)!.push({
      promptId: template.id,
      version: template.version,
      systemPrompt: template.systemPrompt,
      userPrompt: template.userPrompt,
      variables: [...template.variables],
      createdAt: new Date(),
    });
  }
}

// ============================================================================
// Variable Interpolation
// ============================================================================

function interpolate(
  text: string,
  variables: Record<string, unknown>,
  definitions: PromptVariable[],
): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_match, varName: string) => {
    if (varName in variables) {
      const value = variables[varName];
      if (value === null || value === undefined) {
        // Check for default
        const def = definitions.find((v) => v.name === varName);
        if (def?.default !== undefined) {
          return formatValue(def.default);
        }
        return `{{${varName}}}`;
      }
      return formatValue(value);
    }
    return `{{${varName}}}`;
  });
}

function formatValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

// ============================================================================
// Built-in System Prompts
// ============================================================================

export const BUILTIN_PROMPTS: Record<string, Omit<PromptTemplate, "createdAt" | "updatedAt" | "version">> = {
  "data-extraction": {
    id: "builtin-data-extraction",
    name: "Data Extraction",
    description: "Extract structured data from unstructured text",
    systemPrompt:
      "You are a precise data extraction assistant. Extract the requested information from the provided text. Return ONLY valid JSON matching the specified schema. Do not include any other text, explanation, or markdown formatting.",
    userPrompt:
      "Extract the following information from the text below:\n\nSchema: {{schema}}\n\nText to analyze:\n{{text}}\n\nReturn JSON only.",
    variables: [
      { name: "schema", type: "string", required: true, description: "JSON schema for the output" },
      { name: "text", type: "string", required: true, description: "Text to extract data from" },
    ],
    tags: ["extraction", "data", "json"],
    category: "data",
  },

  "text-classification": {
    id: "builtin-text-classification",
    name: "Text Classification",
    description: "Classify text into predefined categories",
    systemPrompt:
      "You are a classification assistant. Classify the given text into one of the provided categories. Return a JSON object with 'category' and 'confidence' (0-1) fields. Only return JSON.",
    userPrompt:
      "Categories: {{categories}}\n\nText to classify:\n{{text}}\n\nReturn JSON: {\"category\": \"...\", \"confidence\": 0.0}",
    variables: [
      { name: "categories", type: "string", required: true, description: "Comma-separated category names" },
      { name: "text", type: "string", required: true, description: "Text to classify" },
    ],
    tags: ["classification", "routing"],
    category: "ai",
  },

  "summarization": {
    id: "builtin-summarization",
    name: "Text Summarization",
    description: "Summarize long text into key points",
    systemPrompt:
      "You are a summarization assistant. Create a concise summary of the provided text. Focus on key points and actionable information. Be accurate and avoid hallucination.",
    userPrompt:
      "Summarize the following text. Length: {{length}}. Format: {{format}}.\n\nText:\n{{text}}",
    variables: [
      { name: "text", type: "string", required: true, description: "Text to summarize" },
      { name: "length", type: "string", required: false, default: "brief", description: "Desired summary length: brief, medium, or detailed" },
      { name: "format", type: "string", required: false, default: "paragraphs", description: "Output format: paragraphs, bullets, or json" },
    ],
    tags: ["summarization", "text"],
    category: "ai",
  },

  "agent-system": {
    id: "builtin-agent-system",
    name: "AI Agent System Prompt",
    description: "Default system prompt for autonomous AI agents",
    systemPrompt:
      `You are an AI assistant executing a workflow automation task. You have access to the following capabilities:
- Call tools to perform actions (API calls, database queries, sending messages)
- Retrieve information from knowledge bases
- Make decisions based on data and rules

Guidelines:
1. Plan your approach before acting. Think step by step.
2. Use the simplest solution that works. Don't overcomplicate.
3. When you have enough information, synthesize your findings clearly.
4. If you're uncertain, ask for clarification or request human input.
5. Never fabricate information. If you don't know, say so.
6. Respect the user's time — be efficient.

Your response should include a confidence score (0-1) indicating how certain you are of your answer.`,
    userPrompt: "{{task}}",
    variables: [
      { name: "task", type: "string", required: true, description: "The task to perform" },
    ],
    tags: ["agent", "system"],
    category: "agent",
  },

  "router-classify": {
    id: "builtin-router-classify",
    name: "AI Router Classification",
    description: "Classify input to route workflow branches",
    systemPrompt:
      "You are a routing assistant. Determine which branch of a workflow the given input should follow. Return JSON with 'route' and 'confidence' fields.",
    userPrompt:
      "Available routes:\n{{routes}}\n\nInput:\n{{input}}\n\nReturn JSON: {\"route\": \"<route_name>\", \"confidence\": 0.0}",
    variables: [
      { name: "routes", type: "string", required: true, description: "Description of available routes" },
      { name: "input", type: "string", required: true, description: "Input to classify" },
    ],
    tags: ["routing", "classification"],
    category: "ai",
  },
};

/**
 * Create a prompt manager pre-loaded with built-in prompts.
 */
export function createPromptManager(): PromptManager {
  const manager = new PromptManager();
  for (const [, template] of Object.entries(BUILTIN_PROMPTS)) {
    manager.register(template);
  }
  return manager;
}

// ============================================================================
// Prompt Testing Utility
// ============================================================================

export interface PromptTestResult {
  templateId: string;
  version: number;
  input: Record<string, unknown>;
  output: string;
  model: string;
  usage?: { promptTokens: number; completionTokens: number };
  durationMs: number;
  error?: string;
}

/**
 * Test a prompt template against multiple models or inputs.
 */
export async function testPrompt(
  promptManager: PromptManager,
  templateId: string,
  inputs: Record<string, unknown>[],
  models: string[],
  runFn: (
    systemPrompt: string,
    userPrompt: string,
    model: string,
  ) => Promise<{ content: string; usage?: { promptTokens: number; completionTokens: number } }>,
): Promise<PromptTestResult[]> {
  const template = promptManager.get(templateId);
  if (!template) {
    throw new FatalError(`Template not found: ${templateId}`);
  }

  const results: PromptTestResult[] = [];

  for (const input of inputs) {
    for (const model of models) {
      const startTime = Date.now();
      try {
        const { system, user } = promptManager.render(template, input);
        const result = await runFn(system, user, model);

        results.push({
          templateId,
          version: template.version,
          input,
          output: result.content,
          model,
          usage: result.usage,
          durationMs: Date.now() - startTime,
        });
      } catch (err) {
        results.push({
          templateId,
          version: template.version,
          input,
          output: "",
          model,
          durationMs: Date.now() - startTime,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  return results;
}
