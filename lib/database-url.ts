/**
 * Production database TLS validation.
 *
 * `sslmode=no-verify` and a missing sslmode both allow an unauthenticated or
 * downgraded connection to a remote database. In production, fail closed unless
 * the connection string explicitly verifies the server certificate.
 */

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

function isRemoteDatabase(hostname: string): boolean {
  return !LOCAL_HOSTS.has(hostname.toLowerCase());
}

function isSecureSslMode(mode: string | null, libpqCompat: boolean): boolean {
  if (!mode) return false;
  const normalized = mode.toLowerCase();

  if (normalized === "verify-full") return true;
  // pg-connection-string's non-libpq mode still verifies certificates for
  // "require"; libpq-compatible mode explicitly disables verification.
  if (normalized === "require" && !libpqCompat) return true;
  return false;
}

export function validateDatabaseUrl(connectionString: string): void {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error("DATABASE_URL is not a valid PostgreSQL connection URL.");
  }

  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error("DATABASE_URL must use the postgres:// or postgresql:// scheme.");
  }

  if (!isRemoteDatabase(url.hostname)) return;

  const sslmode = url.searchParams.get("sslmode");
  const libpqCompat = url.searchParams.get("uselibpqcompat")?.toLowerCase() === "true";
  const secure = isSecureSslMode(sslmode, libpqCompat);

  if (process.env.NODE_ENV === "production") {
    if (!secure) {
      throw new Error(
        "Refusing to connect to a remote production database without verified TLS. " +
          "Set sslmode=verify-full in DATABASE_URL (and remove uselibpqcompat=true).",
      );
    }
    return;
  }

  if (!secure) {
    console.warn(
      "[db] Remote database TLS is not verified. Use sslmode=verify-full outside localhost.",
    );
  }
}
