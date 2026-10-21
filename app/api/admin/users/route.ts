import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/session";
import { recordAudit, clientIp } from "@/lib/audit";

/**
 * Admin account management.
 * All methods require an ADMIN session.
 *
 * Deletion is deliberately conservative: users own events, payments and
 * templates via ON DELETE RESTRICT foreign keys, and payment rows are
 * financial records. Accounts with any of those cannot be deleted —
 * neither through this API nor (safely) through SQL. Self-deletion and
 * demoting/removing the last ADMIN are blocked as well. Every change is
 * written to AuditLog.
 */

const ROLES = ["ADMIN", "ORGANIZER", "STAFF"] as const;
const AUTH_STATUSES = ["PENDING", "APPROVED", "REJECTED", "SUSPENDED"] as const;

export async function GET() {
  try {
    const admin = await requireAdmin();
    if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const users = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        username: true,
        name: true,
        role: true,
        authorizationStatus: true,
        createdAt: true,
        _count: { select: { events: true, payments: true, cardTemplates: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json({ currentUserId: admin.userId, users });
  } catch (error) {
    console.error("Admin users fetch error:", error);
    return NextResponse.json({ error: "Unable to load users" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const admin = await requireAdmin();
    if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const ip = clientIp(request);

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const userId = typeof body.userId === "string" ? body.userId : "";
    const role = typeof body.role === "string" ? body.role : undefined;
    const authorizationStatus = typeof body.authorizationStatus === "string" ? body.authorizationStatus : undefined;

    if (!userId || (role === undefined && authorizationStatus === undefined)) {
      return NextResponse.json({ error: "A user ID and at least one field to change are required" }, { status: 400 });
    }
    if (role !== undefined && !(ROLES as readonly string[]).includes(role)) {
      return NextResponse.json({ error: "Invalid role" }, { status: 400 });
    }
    if (authorizationStatus !== undefined && !(AUTH_STATUSES as readonly string[]).includes(authorizationStatus)) {
      return NextResponse.json({ error: "Invalid authorization status" }, { status: 400 });
    }

    const target = await prisma.user.findUnique({ where: { id: userId } });
    if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 });

    if (role !== undefined && role !== target.role) {
      // Never let an admin lock themselves out of the portal.
      if (userId === admin.userId) {
        return NextResponse.json({ error: "You cannot change your own role" }, { status: 409 });
      }
      // The platform must always keep at least one ADMIN.
      if (target.role === "ADMIN" && role !== "ADMIN") {
        const otherAdmins = await prisma.user.count({ where: { role: "ADMIN", id: { not: userId } } });
        if (otherAdmins === 0) {
          return NextResponse.json({ error: "This is the last ADMIN account — promote another admin first" }, { status: 409 });
        }
      }
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data: {
        ...(role !== undefined ? { role: role as "ADMIN" | "ORGANIZER" | "STAFF" } : {}),
        ...(authorizationStatus !== undefined
          ? { authorizationStatus: authorizationStatus as "PENDING" | "APPROVED" | "REJECTED" | "SUSPENDED" }
          : {}),
      },
      select: { id: true, email: true, role: true, authorizationStatus: true },
    });

    await recordAudit({
      actorId: admin.userId,
      action: "user.updated",
      entityType: "user",
      entityId: userId,
      metadata: {
        email: target.email,
        before: { role: target.role, authorizationStatus: target.authorizationStatus },
        after: { role: updated.role, authorizationStatus: updated.authorizationStatus },
      },
      ipAddress: ip,
    });
    return NextResponse.json({ success: true, user: updated });
  } catch (error) {
    console.error("Admin user update error:", error);
    return NextResponse.json({ error: "Unable to update user" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const admin = await requireAdmin();
    if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const ip = clientIp(request);

    const userId = new URL(request.url).searchParams.get("id") || "";
    if (!userId) return NextResponse.json({ error: "A user ID is required" }, { status: 400 });

    const target = await prisma.user.findUnique({
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        authorizationStatus: true,
        _count: { select: { events: true, payments: true, cardTemplates: true } },
      },
      where: { id: userId },
    });
    if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 });

    if (userId === admin.userId) {
      return NextResponse.json({ error: "You cannot delete your own account" }, { status: 409 });
    }
    if (target.role === "ADMIN") {
      const otherAdmins = await prisma.user.count({ where: { role: "ADMIN", id: { not: userId } } });
      if (otherAdmins === 0) {
        return NextResponse.json({ error: "This is the last ADMIN account and cannot be deleted" }, { status: 409 });
      }
    }
    const { events, payments, cardTemplates } = target._count;
    if (events + payments + cardTemplates > 0) {
      return NextResponse.json(
        {
          error:
            `Cannot delete ${target.email}: the account owns ${events} event(s), ${payments} payment record(s) ` +
            `and ${cardTemplates} template(s). Payment records are financial history and events reference their owner.`,
        },
        { status: 409 },
      );
    }

    await prisma.user.delete({ where: { id: userId } });
    await recordAudit({
      actorId: admin.userId,
      action: "user.deleted",
      entityType: "user",
      entityId: userId,
      metadata: {
        email: target.email,
        name: target.name,
        role: target.role,
        authorizationStatus: target.authorizationStatus,
      },
      ipAddress: ip,
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Admin user delete error:", error);
    return NextResponse.json({ error: "Unable to delete user" }, { status: 500 });
  }
}
