import jwt from "jsonwebtoken";

/**
 * Central JWT configuration (Step 4).
 *
 * Every file that signs or verifies a session token must import from here so
 * there is exactly ONE secret definition in the codebase. The secret must come
 * from the JWT_SECRET environment variable. A development-only fallback exists
 * so `npm run dev` works before the variable is configured; in production a
 * missing secret throws, because a predictable fallback secret would let anyone
 * forge admin sessions.
 */

const DEV_FALLBACK_SECRET = "ecard-dev-only-insecure-secret";

export interface SessionTokenPayload {
  userId: string;
  email: string;
  role: string;
}

export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET?.trim();
  if (secret) return secret;

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "JWT_SECRET is not set. Add it to the environment before running in production.",
    );
  }

  console.warn(
    "[auth] JWT_SECRET is not set — using the insecure development fallback. Set JWT_SECRET in .env.",
  );
  return DEV_FALLBACK_SECRET;
}

export function signSessionToken(payload: SessionTokenPayload): string {
  return jwt.sign(payload, getJwtSecret(), { expiresIn: "7d" });
}

/** Returns the verified payload, or null when the token is missing/invalid/expired. */
export function verifySessionToken(token: string): SessionTokenPayload | null {
  try {
    const claims = jwt.verify(token, getJwtSecret()) as Partial<SessionTokenPayload>;
    if (!claims.userId) return null;
    return claims as SessionTokenPayload;
  } catch {
    return null;
  }
}
