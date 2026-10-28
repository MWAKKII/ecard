import { prisma } from "@/lib/prisma";
import { requestIp } from "@/lib/client-ip";

/**
 * Audit trail helper (spec section 15).
 *
 * Security-relevant actions (payment verification, event authorization,
 * guest edits, card generation, attendance) must be recorded with actor,
 * action, target and timestamp.
 */

export interface AuditEntry {
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
}

export async function recordAudit(entry: AuditEntry): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        actorId: entry.actorId,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        metadata: entry.metadata ? (entry.metadata as object) : undefined,
        ipAddress: entry.ipAddress ?? null,
      },
    });
  } catch (error) {
    // Never let audit persistence break the business action that was already
    // authorized, but make the failure loud in server logs.
    console.error(`[audit] Failed to record "${entry.action}"`, error);
  }
}

/** Best-effort client IP extraction for audit records. */
export function clientIp(request: Request): string | null {
  return requestIp(request);
}
