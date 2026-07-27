// ============================================================================
// FlowMind Auth — Core Authentication Module
// ============================================================================
// Handles registration, login, token refresh, and token verification.
// Passwords are hashed with bcrypt (12 rounds). Refresh tokens are
// stored as SHA-256 hashes in the database for revocation support.
import bcrypt from "bcrypt";
import { createHash, randomBytes } from "node:crypto";
import { db, schema } from "../db/index.js";
import { eq, and } from "drizzle-orm";
import {
  signAccessToken,
  signRefreshToken,
  verify as verifyJwt,
  type AccessTokenPayload,
  type RefreshTokenPayload,
} from "./jwt.js";

const BCRYPT_ROUNDS = 12;
const REFRESH_TOKEN_BYTES = 48;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface UserRecord {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  emailVerifiedAt: Date | null;
  createdAt: Date;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number; // seconds until access token expires
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function generateRefreshTokenValue(): string {
  return randomBytes(REFRESH_TOKEN_BYTES).toString("base64url");
}

function toUserRecord(row: typeof schema.users.$inferSelect): UserRecord {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    avatarUrl: row.avatarUrl,
    emailVerifiedAt: row.emailVerifiedAt,
    createdAt: row.createdAt,
  };
}

// ---------------------------------------------------------------------------
// register(email, password, name)
// ---------------------------------------------------------------------------
export async function register(
  email: string,
  password: string,
  name: string,
): Promise<{ user: UserRecord; tokens: TokenPair }> {
  // Check for existing user
  const existing = await db.query.users.findFirst({
    where: eq(schema.users.email, email.toLowerCase().trim()),
  });
  if (existing) {
    throw Object.assign(new Error("A user with this email already exists."), {
      statusCode: 409,
      code: "CONFLICT",
    });
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  const [user] = await db
    .insert(schema.users)
    .values({
      email: email.toLowerCase().trim(),
      passwordHash,
      name: name.trim(),
    })
    .returning();

  if (!user) {
    throw Object.assign(new Error("Failed to create user."), {
      statusCode: 500,
      code: "INTERNAL_ERROR",
    });
  }

  const tokens = await issueTokenPair(user.id);

  return { user: toUserRecord(user), tokens };
}

// ---------------------------------------------------------------------------
// login(email, password)
// ---------------------------------------------------------------------------
export async function login(
  email: string,
  password: string,
): Promise<{ user: UserRecord; tokens: TokenPair }> {
  const user = await db.query.users.findFirst({
    where: eq(schema.users.email, email.toLowerCase().trim()),
  });

  if (!user || !user.passwordHash) {
    throw Object.assign(new Error("Invalid email or password."), {
      statusCode: 401,
      code: "UNAUTHORIZED",
    });
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    throw Object.assign(new Error("Invalid email or password."), {
      statusCode: 401,
      code: "UNAUTHORIZED",
    });
  }

  const tokens = await issueTokenPair(user.id);
  return { user: toUserRecord(user), tokens };
}

// ---------------------------------------------------------------------------
// refreshToken(token)
// ---------------------------------------------------------------------------
export async function refreshToken(
  rawToken: string,
): Promise<{ accessToken: string; expiresIn: number }> {
  // Validate JWT structure and expiry
  let payload: RefreshTokenPayload;
  try {
    payload = verifyJwt<RefreshTokenPayload>(rawToken);
  } catch {
    throw Object.assign(new Error("Invalid or expired refresh token."), {
      statusCode: 401,
      code: "UNAUTHORIZED",
    });
  }

  if (payload.type !== "refresh") {
    throw Object.assign(new Error("Invalid token type."), {
      statusCode: 401,
      code: "UNAUTHORIZED",
    });
  }

  // Check token hash exists and is not revoked
  const tokenHash = hashToken(rawToken);
  const stored = await db.query.refreshTokens.findFirst({
    where: and(
      eq(schema.refreshTokens.tokenHash, tokenHash),
      eq(schema.refreshTokens.revoked, false),
    ),
  });

  if (!stored) {
    throw Object.assign(new Error("Refresh token has been revoked or not found."), {
      statusCode: 401,
      code: "UNAUTHORIZED",
    });
  }

  // Check if token is expired
  if (stored.expiresAt < new Date()) {
    // Revoke expired token
    await db
      .update(schema.refreshTokens)
      .set({ revoked: true })
      .where(eq(schema.refreshTokens.id, stored.id));
    throw Object.assign(new Error("Refresh token has expired."), {
      statusCode: 401,
      code: "UNAUTHORIZED",
    });
  }

  // Revoke the old refresh token (rotation)
  await db
    .update(schema.refreshTokens)
    .set({ revoked: true })
    .where(eq(schema.refreshTokens.id, stored.id));

  // Issue new pair
  const tokens = await issueTokenPair(payload.sub);

  return {
    accessToken: tokens.accessToken,
    expiresIn: tokens.expiresIn,
  };
}

// ---------------------------------------------------------------------------
// verifyToken(token) — validates JWT and returns the user record
// ---------------------------------------------------------------------------
export async function verifyToken(token: string): Promise<UserRecord> {
  let payload: AccessTokenPayload;
  try {
    payload = verifyJwt<AccessTokenPayload>(token);
  } catch {
    throw Object.assign(new Error("Invalid or expired access token."), {
      statusCode: 401,
      code: "UNAUTHORIZED",
    });
  }

  const user = await db.query.users.findFirst({
    where: eq(schema.users.id, payload.sub),
  });

  if (!user || user.deletedAt) {
    throw Object.assign(new Error("User not found or deactivated."), {
      statusCode: 401,
      code: "UNAUTHORIZED",
    });
  }

  return toUserRecord(user);
}

// ---------------------------------------------------------------------------
// revokeRefreshToken(rawToken) — explicitly revoke a refresh token (logout)
// ---------------------------------------------------------------------------
export async function revokeRefreshToken(rawToken: string): Promise<void> {
  const tokenHash = hashToken(rawToken);
  await db
    .update(schema.refreshTokens)
    .set({ revoked: true })
    .where(eq(schema.refreshTokens.tokenHash, tokenHash));
}

// ---------------------------------------------------------------------------
// Internal: issue a token pair and persist the refresh token hash
// ---------------------------------------------------------------------------
async function issueTokenPair(userId: string): Promise<TokenPair> {
  const accessToken = signAccessToken(userId);
  const rawRefresh = generateRefreshTokenValue();
  const signedRefresh = signRefreshToken(userId);

  // Store hash of the raw refresh value
  const tokenHash = hashToken(rawRefresh);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

  await db.insert(schema.refreshTokens).values({
    userId,
    tokenHash,
    expiresAt,
  });

  // Return both signed tokens + the raw refresh token
  // The client stores the raw refresh token; we store its hash.
  return {
    accessToken,
    refreshToken: rawRefresh, // Return raw, not the JWT-wrapped version
    expiresIn: 15 * 60, // 15 minutes in seconds
  };
}
