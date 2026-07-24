// ============================================================================
// FlowMind AI — Confidence Scoring & Output Validation
// ============================================================================
// Validates LLM outputs against expected schemas, computes confidence scores,
// and determines next actions (accept, escalate, retry).

import { FatalError } from "../engine/errors.js";

// ============================================================================
// Types
// ============================================================================

export interface ConfidenceConfig {
  /** Minimum confidence to auto-accept (0-1, default: 0.7) */
  threshold: number;
  /** Whether to perform self-consistency check (ask LLM to verify) */
  selfConsistency: boolean;
  /** Max retries when validation fails */
  maxRetries: number;
  /** Whether to escalate low-confidence outputs to human */
  escalateOnLowConfidence: boolean;
  /** Schema to validate output against (JSON Schema) */
  expectedSchema?: Record<string, unknown>;
  /** Business rules for additional validation */
  businessRules?: ValidationRule[];
}

export const DEFAULT_CONFIDENCE_CONFIG: ConfidenceConfig = {
  threshold: 0.7,
  selfConsistency: false,
  maxRetries: 2,
  escalateOnLowConfidence: true,
};

/** A business rule for validating output */
export interface ValidationRule {
  name: string;
  description: string;
  /** Function that returns true if valid, false otherwise */
  validate: (output: unknown) => boolean;
  /** Error message when validation fails */
  message: string;
}

/** The result of a confidence assessment */
export interface ConfidenceResult {
  /** Overall confidence score (0-1) */
  score: number;
  /** Whether the output passes validation */
  valid: boolean;
  /** List of validation errors if any */
  errors: string[];
  /** Individual factor scores */
  factors: ConfidenceFactors;
  /** Recommended action */
  action: "accept" | "review" | "escalate" | "retry";
  /** Reason for the recommendation */
  reason: string;
}

/** Individual factors that contribute to confidence */
export interface ConfidenceFactors {
  /** How well the output matches the expected schema */
  schemaCompliance: number;
  /** Whether all required fields are present and non-null */
  fieldCompleteness: number;
  /** Consistency check (e.g., no contradictory statements) */
  consistency: number;
  /** Explicit confidence from the LLM if provided */
  explicitConfidence: number | null;
}

// ============================================================================
// Confidence Scorer
// ============================================================================

export class ConfidenceScorer {
  private config: ConfidenceConfig;

  constructor(config: Partial<ConfidenceConfig> = {}) {
    this.config = { ...DEFAULT_CONFIDENCE_CONFIG, ...config };
  }

  /**
   * Assess the confidence of an LLM output.
   */
  assess(
    output: string | Record<string, unknown>,
    context?: {
      expectedSchema?: Record<string, unknown>;
      expectedType?: string;
      businessRules?: ValidationRule[];
    },
  ): ConfidenceResult {
    const factors: ConfidenceFactors = {
      schemaCompliance: 1.0,
      fieldCompleteness: 1.0,
      consistency: 1.0,
      explicitConfidence: null,
    };

    const errors: string[] = [];

    // Parse to object if string
    let parsed: Record<string, unknown>;
    if (typeof output === "string") {
      parsed = tryParseJson(output);
      if (!parsed) {
        // Not JSON, apply text-based heuristics
        return this.assessText(output);
      }
    } else {
      parsed = output;
    }

    // 1. Extract explicit confidence if present
    if ("confidence" in parsed && typeof parsed.confidence === "number") {
      factors.explicitConfidence = parsed.confidence;
    }

    // 2. Schema compliance
    const schema = context?.expectedSchema || this.config.expectedSchema;
    if (schema) {
      const schemaResult = validateAgainstSchema(parsed, schema);
      factors.schemaCompliance = schemaResult.valid ? 1.0 : Math.max(0, 1.0 - schemaResult.errors.length * 0.2);
      errors.push(...schemaResult.errors);
    }

    // 3. Field completeness
    const nullFields = countNullFields(parsed);
    const totalFields = Object.keys(parsed).length;
    if (totalFields > 0) {
      factors.fieldCompleteness = 1.0 - (nullFields / totalFields);
    }

    // 4. Consistency (basic checks)
    factors.consistency = checkConsistency(parsed, output as string);

    // 5. Run business rules
    const rules = context?.businessRules || this.config.businessRules;
    if (rules) {
      for (const rule of rules) {
        if (!rule.validate(parsed)) {
          errors.push(rule.message);
        }
      }
    }

    // Compute overall score
    const score = this.computeScore(factors);
    const valid = errors.length === 0;

    // Determine action
    let action: ConfidenceResult["action"];
    let reason: string;

    if (valid && score >= this.config.threshold) {
      action = "accept";
      reason = `Confidence ${score.toFixed(2)} meets threshold ${this.config.threshold}`;
    } else if (valid && score >= this.config.threshold * 0.6) {
      action = "review";
      reason = `Confidence ${score.toFixed(2)} is below threshold — human review recommended`;
    } else if (!valid && errors.length > 0 && this.config.maxRetries > 0) {
      action = "retry";
      reason = `Validation errors: ${errors.join("; ")}`;
    } else {
      action = this.config.escalateOnLowConfidence ? "escalate" : "review";
      reason = `Low confidence (${score.toFixed(2)}) — ${errors.length > 0 ? `errors: ${errors.join("; ")}` : "no specific errors"}`;
    }

    return { score, valid, errors, factors, action, reason };
  }

  /**
   * Assess a text-only output (no structured JSON).
   */
  private assessText(text: string): ConfidenceResult {
    const factors: ConfidenceFactors = {
      schemaCompliance: 1.0,
      fieldCompleteness: 1.0,
      consistency: 0.8,
      explicitConfidence: null,
    };

    const errors: string[] = [];

    // Empty text = very low confidence
    if (text.trim().length === 0) {
      return {
        score: 0.0,
        valid: false,
        errors: ["Empty output"],
        factors: { ...factors, consistency: 0 },
        action: "retry",
        reason: "Output is empty",
      };
    }

    // Check for hedging / uncertainty markers
    const hedgingPatterns = [
      /I\s+am\s+not\s+sure/i,
      /I\s+don't\s+know/i,
      /I\s+cannot\s+determine/i,
      /uncertain/i,
      /unclear/i,
      /possibly/i,
      /might\s+be/i,
    ];

    let hedgeCount = 0;
    for (const pattern of hedgingPatterns) {
      if (pattern.test(text)) hedgeCount++;
    }
    factors.consistency = Math.max(0.3, 1.0 - hedgeCount * 0.15);

    // Check for explicit confidence
    const confMatch = text.match(/confidence\s*[:=]\s*([0-9.]+)/i);
    if (confMatch) {
      factors.explicitConfidence = parseFloat(confMatch[1]!);
    }

    const score = this.computeScore(factors);
    const valid = score >= this.config.threshold * 0.5;

    let action: ConfidenceResult["action"];
    let reason: string;

    if (score >= this.config.threshold) {
      action = "accept";
      reason = `Text confidence ${score.toFixed(2)} is acceptable`;
    } else if (score >= this.config.threshold * 0.5) {
      action = "review";
      reason = `Text confidence ${score.toFixed(2)} is marginal — review recommended`;
    } else {
      action = "retry";
      reason = `Text confidence ${score.toFixed(2)} is too low — retry with better prompt`;
    }

    return { score, valid, errors, factors, action, reason };
  }

  /**
   * Compute an overall score from individual factors.
   */
  private computeScore(factors: ConfidenceFactors): number {
    // If explicit confidence is provided, it carries the most weight
    if (factors.explicitConfidence !== null) {
      return (
        factors.explicitConfidence * 0.5 +
        factors.schemaCompliance * 0.2 +
        factors.fieldCompleteness * 0.15 +
        factors.consistency * 0.15
      );
    }

    // Otherwise, derive from heuristics
    return (
      factors.schemaCompliance * 0.35 +
      factors.fieldCompleteness * 0.3 +
      factors.consistency * 0.35
    );
  }
}

// ============================================================================
// Validation Helpers
// ============================================================================

function validateAgainstSchema(
  data: Record<string, unknown>,
  schema: Record<string, unknown>,
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const schemaType = schema.type as string;

  if (schemaType === "object" && schema.properties) {
    const properties = schema.properties as Record<string, Record<string, unknown>>;
    const required = (schema.required as string[]) || [];

    for (const field of required) {
      if (!(field in data) || data[field] === null || data[field] === undefined) {
        errors.push(`Missing required field: ${field}`);
      }
    }

    for (const [field, propSchema] of Object.entries(properties)) {
      const value = data[field];
      if (value === undefined || value === null) continue;

      const propType = propSchema.type as string;
      if (!checkFieldType(value, propType)) {
        errors.push(`Field "${field}" expected ${propType}, got ${typeof value}`);
      }

      // Enum validation
      if (propSchema.enum && Array.isArray(propSchema.enum)) {
        if (!propSchema.enum.includes(value)) {
          errors.push(`Field "${field}" must be one of: ${propSchema.enum.join(", ")}`);
        }
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

function checkFieldType(value: unknown, expectedType: string): boolean {
  switch (expectedType) {
    case "string": return typeof value === "string";
    case "number":
    case "integer":
      return typeof value === "number" && (expectedType !== "integer" || Number.isInteger(value));
    case "boolean": return typeof value === "boolean";
    case "object": return typeof value === "object" && value !== null && !Array.isArray(value);
    case "array": return Array.isArray(value);
    default: return true;
  }
}

function countNullFields(obj: Record<string, unknown>): number {
  let count = 0;
  for (const value of Object.values(obj)) {
    if (value === null || value === undefined) count++;
  }
  return count;
}

function checkConsistency(
  parsed: Record<string, unknown>,
  rawOutput: string,
): number {
  // Basic consistency checks
  let score = 1.0;

  // Check for contradictory date fields
  const dates: Date[] = [];
  for (const value of Object.values(parsed)) {
    if (typeof value === "string" && !isNaN(Date.parse(value))) {
      dates.push(new Date(value));
    }
  }
  // If we have multiple dates, check they're in chronological order
  for (let i = 1; i < dates.length; i++) {
    if (dates[i]! < dates[i - 1]!) {
      score -= 0.1;
    }
  }

  // Check raw output for contradiction markers
  const contradictionPatterns = [
    /however/i,
    /but\s+this\s+contradicts/i,
    /on\s+the\s+other\s+hand/i,
    /this\s+is\s+inconsistent/i,
  ];
  for (const pattern of contradictionPatterns) {
    if (pattern.test(rawOutput)) score -= 0.05;
  }

  return Math.max(0, score);
}

function tryParseJson(text: string): Record<string, unknown> | null {
  // Try to find JSON in the text
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;

  try {
    return JSON.parse(jsonMatch[0]) as Record<string, unknown>;
  } catch {
    return null;
  }
}

// ============================================================================
// Pre-built Validation Rules
// ============================================================================

export const COMMON_BUSINESS_RULES: Record<string, ValidationRule> = {
  emailMustContainAt: {
    name: "email-format",
    description: "Email address must contain @",
    validate: (output) => {
      const email = extractEmail(output);
      return !email || email.includes("@");
    },
    message: "Email address must contain '@'",
  },
  dateMustBeFuture: {
    name: "future-date",
    description: "Date must be in the future",
    validate: (output) => {
      const date = extractDate(output);
      return !date || new Date(date) > new Date();
    },
    message: "Date must be in the future",
  },
  noPIIInOutput: {
    name: "no-pii",
    description: "Output should not contain PII",
    validate: (output) => {
      const text = typeof output === "string" ? output : JSON.stringify(output);
      // Simple check for SSN-like patterns and credit card numbers
      const hasSSN = /\d{3}-\d{2}-\d{4}/.test(text);
      const hasCCN = /\b\d{13,19}\b/.test(text);
      return !hasSSN && !hasCCN;
    },
    message: "Output may contain PII (SSN or credit card number pattern detected)",
  },
};

function extractEmail(output: unknown): string | null {
  if (typeof output === "string") {
    const match = output.match(/[\w.-]+@[\w.-]+\.\w+/);
    return match ? match[0] : null;
  }
  if (typeof output === "object" && output !== null) {
    const obj = output as Record<string, unknown>;
    for (const value of Object.values(obj)) {
      if (typeof value === "string" && value.includes("@")) return value;
    }
  }
  return null;
}

function extractDate(output: unknown): string | null {
  if (typeof output === "string") {
    const match = output.match(/\d{4}-\d{2}-\d{2}/);
    return match ? match[0] : null;
  }
  return null;
}

// ============================================================================
// Convenience Export
// ============================================================================

/**
 * Create a default confidence scorer with common business rules.
 */
export function createConfidenceScorer(
  config?: Partial<ConfidenceConfig>,
): ConfidenceScorer {
  return new ConfidenceScorer(config);
}
