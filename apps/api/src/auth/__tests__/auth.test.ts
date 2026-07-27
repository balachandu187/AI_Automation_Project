// ============================================================================
// FlowMind Auth — Unit Tests
// ============================================================================
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import Fastify from "fastify";

// ---------------------------------------------------------------------------
// Mock bcrypt — inline factory using global vi.fn()
// ---------------------------------------------------------------------------
vi.mock("bcrypt", () => ({
  default: {
    hash: vi.fn(),
    compare: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Mock jsonwebtoken — inline factory using global vi.fn()
// ---------------------------------------------------------------------------
vi.mock("jsonwebtoken", () => ({
  default: {
    sign: vi.fn(),
    verify: vi.fn(),
    decode: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Mock database module — inline factory using global vi.fn()
// ---------------------------------------------------------------------------
vi.mock("../../db/index.js", () => ({
  db: {
    query: {
      users: { findFirst: vi.fn() },
      refreshTokens: { findFirst: vi.fn() },
      workspaceMembers: { findFirst: vi.fn() },
      workspaces: { findFirst: vi.fn() },
    },
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    select: vi.fn(),
  },
  schema: {
    users: {},
    refreshTokens: {},
    workspaceMembers: {},
    workspaces: {},
    organizations: {},
    organizationMembers: {},
    workflows: {},
    workflowVersions: {},
    workflowNodes: {},
    workflowEdges: {},
    executions: {},
    executionSteps: {},
    integrations: {},
    integrationCredentials: {},
    aiConversations: {},
    aiMessages: {},
    auditLogs: {},
    deadLetterEvents: {},
  },
}));

// ---------------------------------------------------------------------------
// Mock config
// ---------------------------------------------------------------------------
vi.mock("../../config.js", () => ({
  loadConfig: () => ({
    NODE_ENV: "test",
    API_PORT: 3001,
    DATABASE_URL: "postgres://test:test@localhost/test",
    REDIS_URL: "redis://localhost:6379",
    JWT_SECRET: "test-secret-at-least-16-chars",
  }),
}));

// ---------------------------------------------------------------------------
// Import modules under test (after mocks)
// ---------------------------------------------------------------------------
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { db } from "../../db/index.js";
import { authRoutes } from "../routes.js";
import { requireRole, Roles } from "../rbac.js";
import { attachRequestId, errorHandler, requireAuth } from "../../routes/middleware.js";

// ---------------------------------------------------------------------------
// Typed mock references for use in tests
// ---------------------------------------------------------------------------
const mockBcryptHash = vi.mocked(bcrypt.hash);
const mockBcryptCompare = vi.mocked(bcrypt.compare);
const mockJwtSign = vi.mocked(jwt.sign);
const mockJwtVerify = vi.mocked(jwt.verify);

const mockUsersFindFirst = vi.mocked(db.query.users.findFirst);
const mockRefreshTokensFindFirst = vi.mocked(db.query.refreshTokens.findFirst);
const mockWorkspaceMembersFindFirst = vi.mocked(db.query.workspaceMembers.findFirst);
const mockDbInsert = vi.mocked(db.insert);
const mockDbUpdate = vi.mocked(db.update);

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------
const TEST_USER = {
  id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  email: "test@flowmind.dev",
  name: "Test User",
  passwordHash: "$2b$12$hashedpasswordvaluehere",
  avatarUrl: null,
  emailVerifiedAt: null,
  createdAt: new Date("2025-01-01"),
  updatedAt: new Date("2025-01-01"),
  deletedAt: null,
};

const TEST_REFRESH_TOKEN = {
  id: "11111111-2222-3333-4444-555555555555",
  userId: TEST_USER.id,
  tokenHash: "abcdef1234567890",
  expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  revoked: false,
  createdAt: new Date(),
};

const JWT_PAYLOAD = {
  sub: TEST_USER.id,
  jti: "jti-12345",
  iat: Math.floor(Date.now() / 1000),
  exp: Math.floor(Date.now() / 1000) + 900,
};

const REFRESH_PAYLOAD = {
  sub: TEST_USER.id,
  jti: "jti-refresh-12345",
  type: "refresh",
  iat: Math.floor(Date.now() / 1000),
  exp: Math.floor(Date.now() / 1000) + 604800,
};

// ---------------------------------------------------------------------------
// App builder
// ---------------------------------------------------------------------------
async function buildApp() {
  const app = Fastify({ logger: false });
  app.addHook("onRequest", attachRequestId);
  app.setErrorHandler(errorHandler);
  await app.register(authRoutes, { prefix: "/api/v1/auth" });

  app.get(
    "/api/v1/test/protected",
    { preHandler: [requireAuth] },
    async (_req, reply) => reply.send({ data: { ok: true } }),
  );

  app.get(
    "/api/v1/test/:wsId/admin-only",
    { preHandler: [requireAuth, requireRole(Roles.ADMIN, Roles.OWNER)] },
    async (_req, reply) => reply.send({ data: { ok: true } }),
  );

  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("Auth Module", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    app = await buildApp();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockDbInsert.mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([TEST_USER]),
      }),
    } as any);
    mockDbUpdate.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    } as any);
  });

  // -------------------------------------------------------------------
  describe("POST /register", () => {
    it("registers a new user and returns tokens", async () => {
      mockUsersFindFirst.mockResolvedValue(null);
      mockBcryptHash.mockResolvedValue("$2b$12$hashed" as never);
      mockJwtSign
        .mockReturnValueOnce("access-token-123" as never)
        .mockReturnValueOnce("refresh-token-456" as never);

      const res = await app.inject({
        method: "POST",
        url: "/api/v1/auth/register",
        payload: { email: "test@flowmind.dev", password: "securepassword123", name: "Test User" },
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body);
      expect(body.data.user.email).toBe("test@flowmind.dev");
      expect(body.data.tokens.accessToken).toBe("access-token-123");
    });

    it("rejects duplicate email", async () => {
      mockUsersFindFirst.mockResolvedValue(TEST_USER as any);
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/auth/register",
        payload: { email: "test@flowmind.dev", password: "securepassword123", name: "Test User" },
      });
      expect(res.statusCode).toBe(409);
    });

    it("rejects invalid email", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/auth/register",
        payload: { email: "not-an-email", password: "securepassword123", name: "Test User" },
      });
      expect(res.statusCode).toBe(400);
    });

    it("rejects short password", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/auth/register",
        payload: { email: "test@flowmind.dev", password: "short", name: "Test User" },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  // -------------------------------------------------------------------
  describe("POST /login", () => {
    it("logs in with valid credentials", async () => {
      mockUsersFindFirst.mockResolvedValue(TEST_USER as any);
      mockBcryptCompare.mockResolvedValue(true as never);
      mockJwtSign
        .mockReturnValueOnce("access-token-login" as never)
        .mockReturnValueOnce("refresh-token-login" as never);

      const res = await app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: { email: "test@flowmind.dev", password: "securepassword123" },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.data.user.email).toBe("test@flowmind.dev");
      expect(body.data.tokens.accessToken).toBe("access-token-login");
    });

    it("rejects invalid password", async () => {
      mockUsersFindFirst.mockResolvedValue(TEST_USER as any);
      mockBcryptCompare.mockResolvedValue(false as never);
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: { email: "test@flowmind.dev", password: "wrongpassword" },
      });
      expect(res.statusCode).toBe(401);
    });

    it("rejects non-existent user", async () => {
      mockUsersFindFirst.mockResolvedValue(null);
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: { email: "nope@flowmind.dev", password: "securepassword123" },
      });
      expect(res.statusCode).toBe(401);
    });
  });

  // -------------------------------------------------------------------
  describe("POST /refresh", () => {
    it("refreshes with valid refresh token", async () => {
      mockJwtVerify.mockReturnValueOnce(REFRESH_PAYLOAD as any);
      mockRefreshTokensFindFirst.mockResolvedValue(TEST_REFRESH_TOKEN as any);
      mockJwtSign.mockReturnValueOnce("new-access-token" as never);

      const res = await app.inject({
        method: "POST",
        url: "/api/v1/auth/refresh",
        payload: { refreshToken: "valid-refresh-token" },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.data.accessToken).toBe("new-access-token");
    });

    it("rejects invalid JWT", async () => {
      mockJwtVerify.mockImplementationOnce(() => {
        throw new Error("invalid token");
      });
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/auth/refresh",
        payload: { refreshToken: "invalid-token" },
      });
      expect(res.statusCode).toBe(401);
    });

    it("rejects revoked token", async () => {
      mockJwtVerify.mockReturnValueOnce(REFRESH_PAYLOAD as any);
      mockRefreshTokensFindFirst.mockResolvedValue(null);
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/auth/refresh",
        payload: { refreshToken: "revoked-token" },
      });
      expect(res.statusCode).toBe(401);
    });

    it("rejects wrong token type", async () => {
      mockJwtVerify.mockReturnValueOnce({ ...JWT_PAYLOAD, type: "access" } as any);
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/auth/refresh",
        payload: { refreshToken: "wrong-type-token" },
      });
      expect(res.statusCode).toBe(401);
    });
  });

  // -------------------------------------------------------------------
  describe("POST /logout", () => {
    it("logs out successfully", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/auth/logout",
        payload: { refreshToken: "some-refresh-token" },
      });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).data.message).toBe("Logged out successfully.");
    });
  });

  // -------------------------------------------------------------------
  describe("GET /me", () => {
    it("returns profile with valid access token", async () => {
      mockJwtVerify.mockReturnValueOnce(JWT_PAYLOAD as any);
      mockUsersFindFirst.mockResolvedValue(TEST_USER as any);

      const res = await app.inject({
        method: "GET",
        url: "/api/v1/auth/me",
        headers: { authorization: "Bearer valid-access-token" },
      });

      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).data.user.email).toBe("test@flowmind.dev");
    });

    it("rejects missing auth header", async () => {
      const res = await app.inject({ method: "GET", url: "/api/v1/auth/me" });
      expect(res.statusCode).toBe(401);
    });

    it("rejects invalid token", async () => {
      mockJwtVerify.mockImplementationOnce(() => {
        throw new Error("jwt expired");
      });
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/auth/me",
        headers: { authorization: "Bearer expired-token" },
      });
      expect(res.statusCode).toBe(401);
    });
  });

  // -------------------------------------------------------------------
  describe("RBAC middleware", () => {
    it("allows admin to admin-only route", async () => {
      mockJwtVerify.mockReturnValueOnce(JWT_PAYLOAD as any);
      mockWorkspaceMembersFindFirst.mockResolvedValue({
        id: "mem-1", workspaceId: "ws-1", userId: TEST_USER.id, role: "admin", createdAt: new Date(),
      } as any);

      const res = await app.inject({
        method: "GET",
        url: "/api/v1/test/ws-1/admin-only",
        headers: { authorization: "Bearer valid-access-token" },
      });
      expect(res.statusCode).toBe(200);
    });

    it("denies viewer to admin-only route", async () => {
      mockJwtVerify.mockReturnValueOnce(JWT_PAYLOAD as any);
      mockWorkspaceMembersFindFirst.mockResolvedValue({
        id: "mem-2", workspaceId: "ws-1", userId: TEST_USER.id, role: "viewer", createdAt: new Date(),
      } as any);

      const res = await app.inject({
        method: "GET",
        url: "/api/v1/test/ws-1/admin-only",
        headers: { authorization: "Bearer valid-access-token" },
      });
      expect(res.statusCode).toBe(403);
    });

    it("denies non-members", async () => {
      mockJwtVerify.mockReturnValueOnce(JWT_PAYLOAD as any);
      mockWorkspaceMembersFindFirst.mockResolvedValue(null);

      const res = await app.inject({
        method: "GET",
        url: "/api/v1/test/ws-1/admin-only",
        headers: { authorization: "Bearer valid-access-token" },
      });
      expect(res.statusCode).toBe(403);
    });

    it("allows editor to basic protected route", async () => {
      mockJwtVerify.mockReturnValueOnce(JWT_PAYLOAD as any);
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/test/protected",
        headers: { authorization: "Bearer valid-access-token" },
      });
      expect(res.statusCode).toBe(200);
    });

    it("rejects non-Bearer auth", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/test/protected",
        headers: { authorization: "Basic some-token" },
      });
      expect(res.statusCode).toBe(401);
    });
  });
});
