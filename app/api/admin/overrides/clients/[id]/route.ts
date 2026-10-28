import { NextResponse } from "next/server";
import type { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/session";
import { normalizeEmail, validateEmail } from "@/lib/auth";
import { recordAudit, clientIp } from "@/lib/audit";
import { readJsonBody } from "@/lib/request";

type RouteContext = { params: Promise<{ id: string }> };

const PHONE_PATTERN = /^\+?[0-9][0-9\s\-()]{5,19}$/;

function cleanOptionalPhone(value: unknown): { ok: true; value: string | null } | { ok: false; reason: string } {
  if (value === null || value === undefined) return { ok: true, value: null };
  if (typeof value !== "string") return { ok: false, reason: "Phone number must be text." };

  const phone = value.trim();
  if (!phone) return { ok: true, value: null };
  if (phone.length > 30 || !PHONE_PATTERN.test(phone)) {
    return { ok: false, reason: "Please enter a valid phone number." };
  }
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) {
    return { ok: false, reason: "Phone number must have 7–15 digits." };
  }
  return { ok: true, value: phone };
}

/**
 * Admin correction of client/account contact information.
 * Role and authorization changes remain on /api/admin/users; this endpoint is
 * intentionally limited to profile fields. Every successful change is audited.
 */
export async function PATCH(request: Request, { params }: RouteContext) {
  try {
    const admin = await requireAdmin();
    if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;
    const target = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        email: true,
        username: true,
        phone: true,
        role: true,
      },
    });
    if (!target) return NextResponse.json({ error: "Client not found" }, { status: 404 });

    const parsed = await readJsonBody(request, 32 * 1024);
    if (!parsed.ok) return parsed.response;
    const body = parsed.body;

    const updates: {
      name?: string;
      email?: string;
      username?: string | null;
      phone?: string | null;
    } = {};
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};

    if (body.name !== undefined) {
      if (typeof body.name !== "string") {
        return NextResponse.json({ error: "Full name must be text." }, { status: 400 });
      }
      const name = body.name.trim();
      if (!name || name.length > 120) {
        return NextResponse.json(
          { error: "Full name is required (max 120 characters)." },
          { status: 400 },
        );
      }
      if (name !== target.name) {
        before.name = target.name;
        after.name = name;
        updates.name = name;
      }
    }

    if (body.email !== undefined) {
      const emailError = validateEmail(body.email);
      if (emailError) return NextResponse.json({ error: emailError }, { status: 400 });
      const email = normalizeEmail(body.email as string);
      if (email !== target.email) {
        before.email = target.email;
        after.email = email;
        updates.email = email;
      }
    }

    if (body.username !== undefined) {
      let username: string | null = null;
      if (body.username !== null) {
        if (typeof body.username !== "string") {
          return NextResponse.json({ error: "Username must be text." }, { status: 400 });
        }
        username = body.username.trim() || null;
      }
      if (username !== null && (username.length < 3 || username.length > 30)) {
        return NextResponse.json(
          { error: "Username must be between 3 and 30 characters." },
          { status: 400 },
        );
      }
      if (username !== target.username) {
        before.username = target.username;
        after.username = username;
        updates.username = username;
      }
    }

    if (body.phone !== undefined) {
      const cleaned = cleanOptionalPhone(body.phone);
      if (!cleaned.ok) return NextResponse.json({ error: cleaned.reason }, { status: 400 });
      if (cleaned.value !== target.phone) {
        before.phone = target.phone;
        after.phone = cleaned.value;
        updates.phone = cleaned.value;
      }
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }

    const conflicts: Prisma.UserWhereInput[] = [];
    if (updates.email) {
      conflicts.push({ email: { equals: updates.email, mode: "insensitive" } });
    }
    if (updates.username) {
      conflicts.push({ username: { equals: updates.username, mode: "insensitive" } });
    }
    if (updates.phone) {
      conflicts.push({ phone: { equals: updates.phone, mode: "insensitive" } });
    }
    if (conflicts.length > 0) {
      const duplicate = await prisma.user.findFirst({
        where: { id: { not: id }, OR: conflicts },
        select: { id: true, email: true, username: true, phone: true },
      });
      if (duplicate) {
        return NextResponse.json(
          { error: "Another account already uses that email, username or phone number." },
          { status: 409 },
        );
      }
    }

    let updated;
    try {
      updated = await prisma.user.update({
        where: { id },
        data: updates,
        select: {
          id: true,
          name: true,
          email: true,
          username: true,
          phone: true,
          role: true,
          authorizationStatus: true,
        },
      });
    } catch (error: unknown) {
      // A concurrent change may beat the pre-check; the unique indexes are final.
      if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
        return NextResponse.json(
          { error: "Another account already uses that email, username or phone number." },
          { status: 409 },
        );
      }
      throw error;
    }

    await recordAudit({
      actorId: admin.userId,
      action: "client.admin_updated",
      entityType: "user",
      entityId: id,
      metadata: {
        targetName: target.name,
        targetEmail: target.email,
        before,
        after,
        source: "admin_override",
      },
      ipAddress: clientIp(request),
    });

    return NextResponse.json({ success: true, client: updated });
  } catch (error) {
    console.error("Admin client override error:", error);
    return NextResponse.json({ error: "Unable to update client information" }, { status: 500 });
  }
}
