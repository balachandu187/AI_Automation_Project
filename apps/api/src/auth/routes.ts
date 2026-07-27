// ============================================================================
// FlowMind Auth — REST Routes
// ============================================================================
// POST /api/v1/auth/register
// POST /api/v1/auth/login
// POST /api/v1/auth/refresh
// POST /api/v1/auth/logout
// GET  /api/v1/auth/me
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import {
  register,
  login,
  refreshToken,
  revokeRefreshToken,
} from "./auth.js";
import { requireAuth } from "../routes/middleware.js";

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------
const registerSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(8).max(128),
  name: z.string().min(1).max(255),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

const logoutSchema = z.object({
  refreshToken: z.string().min(1),
});

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------
export async function authRoutes(app: FastifyInstance): Promise<void> {
  // ---- POST /register ----
  app.post(
    "/register",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = registerSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: {
            code: "VALIDATION_ERROR",
            message: "Invalid request body.",
            details: parsed.error.errors,
          },
        });
      }

      try {
        const { email, password, name } = parsed.data;
        const result = await register(email, password, name);
        return reply.status(201).send({
          data: {
            user: result.user,
            tokens: result.tokens,
          },
        });
      } catch (err: any) {
        const statusCode = err.statusCode || 500;
        return reply.status(statusCode).send({
          error: {
            code: err.code || "INTERNAL_ERROR",
            message: err.message || "Registration failed.",
          },
        });
      }
    },
  );

  // ---- POST /login ----
  app.post(
    "/login",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = loginSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: {
            code: "VALIDATION_ERROR",
            message: "Invalid request body.",
            details: parsed.error.errors,
          },
        });
      }

      try {
        const { email, password } = parsed.data;
        const result = await login(email, password);
        return reply.status(200).send({
          data: {
            user: result.user,
            tokens: result.tokens,
          },
        });
      } catch (err: any) {
        const statusCode = err.statusCode || 500;
        return reply.status(statusCode).send({
          error: {
            code: err.code || "INTERNAL_ERROR",
            message: err.message || "Login failed.",
          },
        });
      }
    },
  );

  // ---- POST /refresh ----
  app.post(
    "/refresh",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = refreshSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: {
            code: "VALIDATION_ERROR",
            message: "Invalid request body.",
            details: parsed.error.errors,
          },
        });
      }

      try {
        const result = await refreshToken(parsed.data.refreshToken);
        return reply.status(200).send({
          data: result,
        });
      } catch (err: any) {
        const statusCode = err.statusCode || 500;
        return reply.status(statusCode).send({
          error: {
            code: err.code || "INTERNAL_ERROR",
            message: err.message || "Token refresh failed.",
          },
        });
      }
    },
  );

  // ---- POST /logout ----
  app.post(
    "/logout",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = logoutSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: {
            code: "VALIDATION_ERROR",
            message: "Invalid request body.",
            details: parsed.error.errors,
          },
        });
      }

      try {
        await revokeRefreshToken(parsed.data.refreshToken);
        return reply.status(200).send({
          data: { message: "Logged out successfully." },
        });
      } catch (err: any) {
        const statusCode = err.statusCode || 500;
        return reply.status(statusCode).send({
          error: {
            code: err.code || "INTERNAL_ERROR",
            message: err.message || "Logout failed.",
          },
        });
      }
    },
  );

  // ---- GET /me ----
  app.get(
    "/me",
    {
      preHandler: [requireAuth],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        // requireAuth already validated the JWT and set userId.
        // Look up the user directly rather than re-verifying the token.
        const { db, schema } = await import("../db/index.js");
        const { eq } = await import("drizzle-orm");
        const user = await db.query.users.findFirst({
          where: eq(schema.users.id, request.userId!),
        });

        if (!user || user.deletedAt) {
          return reply.status(401).send({
            error: {
              code: "UNAUTHORIZED",
              message: "User not found or deactivated.",
            },
          });
        }

        return reply.status(200).send({
          data: {
            user: {
              id: user.id,
              email: user.email,
              name: user.name,
              avatarUrl: user.avatarUrl,
              emailVerifiedAt: user.emailVerifiedAt,
              createdAt: user.createdAt,
            },
          },
        });
      } catch (err: any) {
        const statusCode = err.statusCode || 500;
        return reply.status(statusCode).send({
          error: {
            code: err.code || "INTERNAL_ERROR",
            message: err.message || "Failed to get user profile.",
          },
        });
      }
    },
  );
}
