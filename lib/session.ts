import { cookies } from "next/headers";
import { verifySessionToken } from "@/lib/jwt";
import { prisma } from "@/lib/prisma";

export interface SessionClaims {
  userId: string;
  email: string;
  role: string;
  authorizationStatus: string;
}

/**
 * Returns the authenticated session, or null.
 * The token claims are re-checked against the database so deleted or
 * changed users cannot keep using an old token.
 */
export async function getSession(): Promise<SessionClaims | null> {
  const token = (await cookies()).get("auth_token")?.value;
  if (!token) return null;

  const claims = verifySessionToken(token);
  if (!claims) return null;

  const user = await prisma.user.findUnique({
    where: { id: claims.userId },
    select: { id: true, email: true, role: true, authorizationStatus: true },
  });
  if (!user) return null;

  // Administrative rejection/suspension is an authorization decision, not a
  // cosmetic label. Stop using every existing token immediately.
  if (
    user.authorizationStatus === "REJECTED" ||
    user.authorizationStatus === "SUSPENDED"
  ) {
    return null;
  }

  return {
    userId: user.id,
    email: user.email,
    role: user.role,
    authorizationStatus: user.authorizationStatus,
  };
}

/** Returns the session only when the user is an ADMIN, otherwise null. */
export async function requireAdmin(): Promise<SessionClaims | null> {
  const session = await getSession();
  return session && session.role === "ADMIN" ? session : null;
}

/**
 * Loads an event only when it belongs to the given user.
 * This is the single ownership boundary used by all client-side event,
 * guest and QR operations (spec section 41 — data ownership).
 */
export async function getOwnedEvent(eventId: string, ownerId: string) {
  return prisma.event.findFirst({
    where: { id: eventId, ownerId },
  });
}
