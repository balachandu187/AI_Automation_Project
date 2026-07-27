// ============================================================================
// FlowMind API — Shared Middleware
// ============================================================================
// Request validation (Zod), auth stub, workspace membership, error handling.
// All middleware follows Fastify 5 hook patterns.
import type { FastifyRequest, FastifyReply } from "fastify";
import type { ZodSchema, ZodTypeAny } from "zod";
import { z } from "zod";
import { db, schema } from "../db/index.js";
import { eq, and, sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Type augmentations for Fastify request — carries authenticated user context
// ---------------------------------------------------------------------------
declare module "fastify" {
  interface FastifyRequest {
    userId?: string;
    workspaceId?: string;
    requestId?: string;
  }
}

// ---------------------------------------------------------------------------
// Standard error codes
// ---------------------------------------------------------------------------
export const ErrorCode = {
  VALIDATION_ERROR: "VALIDATION_ERROR",
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  INTERNAL_ERROR: "INTERNAL_ERROR",
  RATE_LIMITED: "RATE_LIMITED",
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------
export interface ApiError {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export interface ApiResponse<T> {
  data: T;
  meta?: {
    total: number;
    page: number;
    limit: number;
  };
}

export function success<T>(data: T): ApiResponse<T> {
  return { data };
}

export function paginated<T>(
  data: T[],
  total: number,
  page: number,
  limit: number,
): ApiResponse<T[]> {
  return { data, meta: { total, page, limit } };
}

export function errorReply(
  code: string,
  message: string,
  statusCode: number,
  details?: unknown,
): { statusCode: number; body: ApiError } {
  return {
    statusCode,
    body: { error: { code, message, details } },
  };
}

// ---------------------------------------------------------------------------
// Pagination schema and helper
// ---------------------------------------------------------------------------
export const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type PaginationQuery = z.infer<typeof paginationQuery>;

export function paginationMeta(
  total: number,
  page: number,
  limit: number,
) {
  return { total, page, limit };
}

// ---------------------------------------------------------------------------
// Validation middleware factory
// ---------------------------------------------------------------------------
interface ValidationSchemas {
  body?: ZodTypeAny;
  params?: ZodTypeAny;
  query?: ZodTypeAny;
}

export function validate(schemas: ValidationSchemas) {
  return async function preValidation(
    request: FastifyRequest,
    reply: FastifyReply,
  ) {
    try {
      if (schemas.params) {
        request.params = schemas.params.parse(request.params) as Record<string, string>;
      }
      if (schemas.query) {
        request.query = schemas.query.parse(request.query);
      }
      if (schemas.body) {
        request.body = schemas.body.parse(request.body);
      }
    } catch (err) {
      if (err instanceof z.ZodError) {
        return reply.status(400).send({
          error: {
            code: ErrorCode.VALIDATION_ERROR,
            message: "Request validation failed",
            details: err.errors.map((e) => ({
              path: e.path.join("."),
              message: e.message,
            })),
          },
        });
      }
      throw err;
    }
  };
}

// ---------------------------------------------------------------------------
// UUID param schema (reusable)
// ---------------------------------------------------------------------------
export const uuidParam = z.object({
  id: z.string().uuid(),
});

export const wsIdParam = z.object({
  wsId: z.string().uuid(),
});

export const workflowIdParam = z.object({
  id: z.string().uuid(),
});

export const wsWorkflowParams = z.object({
  wsId: z.string().uuid(),
  id: z.string().uuid(),
});

// ---------------------------------------------------------------------------
// requireAuth middleware — validates JWT from Authorization header.
// Extracts userId from the token payload and sets it on the request.
// ---------------------------------------------------------------------------
export async function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const authHeader = request.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return reply.status(401).send({
      error: {
        code: ErrorCode.UNAUTHORIZED,
        message: "Authentication required. Provide a Bearer token in the Authorization header.",
      },
    });
  }

  const token = authHeader.slice(7);

  try {
    // Dynamic import to avoid circular dependency with auth module
    const { verify } = await import("../auth/jwt.js");
    const payload = verify(token);
    request.userId = payload.sub;
  } catch {
    return reply.status(401).send({
      error: {
        code: ErrorCode.UNAUTHORIZED,
        message: "Invalid or expired access token.",
      },
    });
  }
}

// ---------------------------------------------------------------------------
// Workspace membership middleware
// Must run after requireAuth. Checks that the authenticated user belongs
// to the workspace identified by :wsId in route params.
// ---------------------------------------------------------------------------
export async function requireWorkspaceMembership(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const params = request.params as Record<string, string> | undefined;
  const wsId = params?.wsId;
  const userId = request.userId;

  if (!wsId || !userId) {
    return reply.status(400).send({
      error: {
        code: ErrorCode.VALIDATION_ERROR,
        message: "Workspace ID and user ID are required.",
      },
    });
  }

  // Check workspace existence and membership
  const workspace = await db.query.workspaces.findFirst({
    where: eq(schema.workspaces.id, wsId),
  });

  if (!workspace) {
    return reply.status(404).send({
      error: {
        code: ErrorCode.NOT_FOUND,
        message: "Workspace not found.",
      },
    });
  }

  const membership = await db.query.workspaceMembers.findFirst({
    where: and(
      eq(schema.workspaceMembers.workspaceId, wsId),
      eq(schema.workspaceMembers.userId, userId),
    ),
  });

  if (!membership) {
    return reply.status(403).send({
      error: {
        code: ErrorCode.FORBIDDEN,
        message: "You are not a member of this workspace.",
      },
    });
  }

  request.workspaceId = wsId;
}

// ---------------------------------------------------------------------------
// Request ID hook — attaches a unique request ID to every response.
// ---------------------------------------------------------------------------
export async function attachRequestId(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const requestId =
    (request.headers["x-request-id"] as string) || crypto.randomUUID();
  request.requestId = requestId;
  reply.header("x-request-id", requestId);
}

// ---------------------------------------------------------------------------
// Global error handler — ensures consistent error response shape.
// ---------------------------------------------------------------------------
export function errorHandler(
  error: Error & { statusCode?: number; validation?: unknown },
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  // Fastify validation errors
  if (error.validation) {
    reply.status(400).send({
      error: {
        code: ErrorCode.VALIDATION_ERROR,
        message: "Request validation failed",
        details: error.validation,
      },
    });
    return;
  }

  // Known status codes
  const statusCode = error.statusCode || 500;

  if (statusCode === 429) {
    reply.status(429).send({
      error: {
        code: ErrorCode.RATE_LIMITED,
        message: error.message || "Too many requests",
      },
    });
    return;
  }

  // Generic error
  reply.status(statusCode).send({
    error: {
      code:
        statusCode === 404
          ? ErrorCode.NOT_FOUND
          : statusCode === 401
            ? ErrorCode.UNAUTHORIZED
            : statusCode === 403
              ? ErrorCode.FORBIDDEN
              : statusCode === 409
                ? ErrorCode.CONFLICT
                : ErrorCode.INTERNAL_ERROR,
      message:
        statusCode === 500
          ? "Internal server error"
          : error.message || "An error occurred",
      ...(statusCode === 500 && process.env.NODE_ENV !== "production"
        ? { details: error.stack }
        : {}),
    },
  });
}

// ---------------------------------------------------------------------------
// Common Zod schemas for route validation
// ---------------------------------------------------------------------------

/** UUID string schema */
export const uuidSchema = z.string().uuid();

/** Workspace creation body */
export const createWorkspaceSchema = z.object({
  name: z.string().min(1).max(255),
  slug: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug must be lowercase alphanumeric with hyphens"),
});

/** Workspace update body */
export const updateWorkspaceSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  slug: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug must be lowercase alphanumeric with hyphens")
    .optional(),
});

/** Workflow creation body */
export const createWorkflowSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(2000).optional(),
  triggerType: z
    .enum(["manual", "webhook", "schedule", "event", "workflow_call"])
    .default("manual"),
  triggerConfig: z.record(z.unknown()).default({}),
});

/** Workflow update body */
export const updateWorkflowSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(2000).optional(),
  status: z.enum(["draft", "active", "paused", "archived"]).optional(),
});

/** Node creation body */
export const createNodeSchema = z.object({
  type: z.string().min(1).max(50),
  label: z.string().min(1).max(255),
  config: z.record(z.unknown()).default({}),
  positionX: z.number().default(0),
  positionY: z.number().default(0),
});

/** Node update body */
export const updateNodeSchema = z.object({
  label: z.string().min(1).max(255).optional(),
  config: z.record(z.unknown()).optional(),
  positionX: z.number().optional(),
  positionY: z.number().optional(),
});

/** Edge creation body */
export const createEdgeSchema = z.object({
  sourceNodeId: z.string().uuid(),
  targetNodeId: z.string().uuid(),
  condition: z.record(z.unknown()).nullable().optional(),
});

/** Integration creation body */
export const createIntegrationSchema = z.object({
  provider: z.string().min(1).max(50),
  name: z.string().min(1).max(255),
  isBuiltin: z.boolean().default(false),
  config: z.record(z.unknown()).default({}),
});

/** Integration update body */
export const updateIntegrationSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  isBuiltin: z.boolean().optional(),
  config: z.record(z.unknown()).optional(),
});

/** Execution list query */
export const executionListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z
    .enum(["pending", "running", "completed", "failed", "cancelled", "awaiting_approval"])
    .optional(),
});
