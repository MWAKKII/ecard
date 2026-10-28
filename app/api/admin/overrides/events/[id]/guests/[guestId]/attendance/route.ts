import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/session";
import { recordAudit, clientIp } from "@/lib/audit";
import { readJsonBody } from "@/lib/request";

type RouteContext = { params: Promise<{ id: string; guestId: string }> };

const ATTENDANCE_STATUSES = ["REGISTERED", "CHECKED_IN", "NO_SHOW", "LEFT"] as const;
type AttendanceStatusName = (typeof ATTENDANCE_STATUSES)[number];

const INVALID_TIMESTAMP = Symbol("invalid-timestamp");

function parseTimestamp(value: unknown): Date | null | typeof INVALID_TIMESTAMP {
  if (value === null || value === "") return null;
  if (typeof value !== "string") return INVALID_TIMESTAMP;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? INVALID_TIMESTAMP : parsed;
}

/**
 * Admin attendance correction.
 *
 * Status/timestamp combinations are normalised server-side:
 * - CHECKED_IN always has a check-in timestamp (now when none is supplied).
 * - REGISTERED and NO_SHOW clear the check-in timestamp.
 * - LEFT may retain the original check-in timestamp.
 * The original check-in actor is preserved for existing check-ins; a new
 * CHECKED_IN correction records the admin as the check-in actor.
 */
export async function PATCH(request: Request, { params }: RouteContext) {
  try {
    const admin = await requireAdmin();
    if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id: eventId, guestId } = await params;
    const [event, guest, existing] = await Promise.all([
      prisma.event.findUnique({
        where: { id: eventId },
        select: { id: true, title: true, ownerId: true },
      }),
      prisma.guest.findFirst({
        where: { id: guestId, eventId },
        select: { id: true, fullName: true },
      }),
      prisma.attendance.findUnique({
        where: { eventId_guestId: { eventId, guestId } },
        select: {
          id: true,
          status: true,
          checkedInAt: true,
          notes: true,
          checkedInById: true,
        },
      }),
    ]);
    if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });
    if (!guest) return NextResponse.json({ error: "Guest not found" }, { status: 404 });

    const parsed = await readJsonBody(request, 32 * 1024);
    if (!parsed.ok) return parsed.response;
    const body = parsed.body;

    if (typeof body.status !== "string") {
      return NextResponse.json({ error: "An attendance status is required." }, { status: 400 });
    }
    const status = body.status.toUpperCase();
    if (!(ATTENDANCE_STATUSES as readonly string[]).includes(status)) {
      return NextResponse.json(
        { error: "Attendance status must be REGISTERED, CHECKED_IN, NO_SHOW or LEFT." },
        { status: 400 },
      );
    }

    const hasCheckedInAt = Object.prototype.hasOwnProperty.call(body, "checkedInAt");
    let checkedInAt = existing?.checkedInAt ?? null;
    if (hasCheckedInAt) {
      const parsed = parseTimestamp(body.checkedInAt);
      if (parsed === INVALID_TIMESTAMP) {
        return NextResponse.json({ error: "The check-in time is invalid." }, { status: 400 });
      }
      checkedInAt = parsed;
    }
    if (status === "CHECKED_IN" && !checkedInAt) checkedInAt = new Date();
    if (status === "REGISTERED" || status === "NO_SHOW") checkedInAt = null;

    let checkedInById = existing?.checkedInById ?? null;
    if (status === "CHECKED_IN") {
      const wasCheckedIn =
        existing?.status === "CHECKED_IN" && existing.checkedInById !== null;
      if (!wasCheckedIn) checkedInById = admin.userId;
    } else if (status === "REGISTERED" || status === "NO_SHOW") {
      checkedInById = null;
    }

    const hasNotes = Object.prototype.hasOwnProperty.call(body, "notes");
    let notes = existing?.notes ?? null;
    if (hasNotes) {
      if (body.notes !== null && typeof body.notes !== "string") {
        return NextResponse.json({ error: "Attendance notes must be text." }, { status: 400 });
      }
      const value = typeof body.notes === "string" ? body.notes.trim() : "";
      if (value.length > 1000) {
        return NextResponse.json(
          { error: "Attendance notes must be 1000 characters or fewer." },
          { status: 400 },
        );
      }
      notes = value || null;
    }

    const current = {
      status: existing?.status ?? "REGISTERED",
      checkedInAt: existing?.checkedInAt ?? null,
      notes: existing?.notes ?? null,
      checkedInById: existing?.checkedInById ?? null,
    };
    const unchanged =
      existing !== null &&
      current.status === status &&
      (current.checkedInAt?.getTime() ?? null) === (checkedInAt?.getTime() ?? null) &&
      current.notes === notes &&
      current.checkedInById === checkedInById;
    if (unchanged || (!existing && status === "REGISTERED" && !checkedInAt && !notes)) {
      return NextResponse.json({ error: "Nothing to correct" }, { status: 400 });
    }

    const attendance = existing
      ? await prisma.attendance.update({
          where: { id: existing.id },
          data: {
            status: status as AttendanceStatusName,
            checkedInAt,
            checkedInById,
            notes,
          },
        })
      : await prisma.attendance.create({
          data: {
            eventId,
            guestId,
            status: status as AttendanceStatusName,
            checkedInAt,
            checkedInById,
            notes,
          },
        });

    await recordAudit({
      actorId: admin.userId,
      action: "attendance.admin_corrected",
      entityType: "attendance",
      entityId: attendance.id,
      metadata: {
        eventId,
        eventTitle: event.title,
        ownerId: event.ownerId,
        guestId,
        guestName: guest.fullName,
        before: existing
          ? {
              status: existing.status,
              checkedInAt: existing.checkedInAt?.toISOString() ?? null,
              notes: existing.notes,
              checkedInById: existing.checkedInById,
            }
          : null,
        after: {
          status: attendance.status,
          checkedInAt: attendance.checkedInAt?.toISOString() ?? null,
          notes: attendance.notes,
          checkedInById: attendance.checkedInById,
        },
        source: "admin_override",
      },
      ipAddress: clientIp(request),
    });

    return NextResponse.json({ success: true, attendance });
  } catch (error) {
    console.error("Admin attendance override error:", error);
    return NextResponse.json({ error: "Unable to correct attendance" }, { status: 500 });
  }
}
