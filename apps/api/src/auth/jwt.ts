// ============================================================================
// FlowMind Auth — JWT Utilities
// ============================================================================
// HS256 tokens with configurable secret and expiry.
import jwt from "jsonwebtoken";
import { loadConfig } from "../config.js";

const config = loadConfig();

export interface AccessTokenPayload {
  sub: string; // userId
  jti: string; // unique token id
}

export interface RefreshTokenPayload {
  sub: string; // userId
  jti: string; // unique token id
  type: "refresh";
}

const ACCESS_EXPIRY = "15m";
const REFRESH_EXPIRY = "7d";

function getSecret(): string {
  return config.JWT_SECRET;
}

/**
 * Sign a short-lived access token for the given user.
 */
export function signAccessToken(userId: string): string {
  const jti = crypto.randomUUID();
  return jwt.sign({ sub: userId, jti } satisfies AccessTokenPayload, getSecret(), {
    algorithm: "HS256",
    expiresIn: ACCESS_EXPIRY,
  });
}

/**
 * Sign a long-lived refresh token for the given user.
 */
export function signRefreshToken(userId: string): string {
  const jti = crypto.randomUUID();
  return jwt.sign(
    { sub: userId, jti, type: "refresh" } satisfies RefreshTokenPayload,
    getSecret(),
    {
      algorithm: "HS256",
      expiresIn: REFRESH_EXPIRY,
    },
  );
}

/**
 * Verify a token and return the decoded payload.
 * Throws on invalid/expired tokens.
 */
export function verify<T extends object = AccessTokenPayload>(token: string): T {
  return jwt.verify(token, getSecret(), {
    algorithms: ["HS256"],
  }) as T;
}

/**
 * Decode a token without verification (useful for inspecting expiry, etc.).
 */
export function decode<T extends object = AccessTokenPayload>(token: string): T | null {
  return jwt.decode(token) as T | null;
}
