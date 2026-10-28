import jwt from "jsonwebtoken";

/**
 * Central JWT configuration.
 *
 * Every file that signs or verifies a session token imports from here so the
 * secret and algorithm have exactly one definition. Production requires a
 * strong, non-placeholder JWT_SECRET; a development fallback is retained only
 * so `npm run dev` works before the variable is configured.
 */

const DEV_FALLBACK_SECRET = "ecard-dev-only-insecure-secret";
const MIN_SECRET_LENGTH = 32;
const VALID_ROLES = new Set(["ADMIN", "ORGANIZER", "STAFF"]);

export interface SessionTokenPayload {
  userId: string;
  email: string;
  role: string;
}

function isInsecureSecret(secret: string): boolean {
  return (
    secret === DEV_FALLBACK_SECRET ||
    /^(replace|change[-_ ]?me|your[-_ ]|example)/i.test(secret)
  );
}

export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET?.trim();
  const isProduction = process.env.NODE_ENV === "production";

  if (secret) {
    if (isProduction && secret.length < MIN_SECRET_LENGTH) {
      throw new Error(
        `JWT_SECRET must be at least ${MIN_SECRET_LENGTH} characters in production.`,
      );
    }
    if (isProduction && isInsecureSecret(secret)) {
      throw new Error("JWT_SECRET is a placeholder or development secret. Generate a random secret.");
    }
    if (!isProduction && secret.length < MIN_SECRET_LENGTH) {
      console.warn(`[auth] JWT_SECRET is shorter than ${MIN_SECRET_LENGTH} characters.`);
    }
    return secret;
  }

  if (isProduction) {
    throw new Error(
      "JWT_SECRET is not set. Add it to the environment before running in production.",
    );
  }

  console.warn(
    "[auth] JWT_SECRET is not set - using the insecure development fallback. Set JWT_SECRET in .env.",
  );
  return DEV_FALLBACK_SECRET;
}

export function signSessionToken(payload: SessionTokenPayload): string {
  return jwt.sign(payload, getJwtSecret(), {
    algorithm: "HS256",
    expiresIn: "7d",
  });
}

/** Returns the verified payload, or null when the token is missing/invalid/expired. */
export function verifySessionToken(token: string): SessionTokenPayload | null {
  try {
    const claims = jwt.verify(token, getJwtSecret(), {
      algorithms: ["HS256"],
    });

    if (typeof claims === "string") return null;
    if (
      typeof claims.exp !== "number" ||
      typeof claims.userId !== "string" ||
      claims.userId.length === 0 ||
      typeof claims.email !== "string" ||
      typeof claims.role !== "string" ||
      !VALID_ROLES.has(claims.role)
    ) {
      return null;
    }

    return {
      userId: claims.userId,
      email: claims.email,
      role: claims.role,
    };
  } catch {
    return null;
  }
}
