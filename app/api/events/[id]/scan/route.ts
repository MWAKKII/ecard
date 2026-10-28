import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession, getOwnedEvent } from "@/lib/session";
import { isValidQrTokenFormat } from "@/lib/qr";
import { recordAudit, clientIp } from "@/lib/audit";
import { readJsonBody } from "@/lib/request";
import { takeRateLimit, type RateLimitResult } from "@/lib/rate-limit";
import { requestIp } from "@/lib/client-ip";

type RouteContext = { params: Promise<{ id: string }> };

function scanRateLimitResponse(limit: RateLimitResult) {
  return NextResponse.json(
    {
      state: "rate_limited",
      error: "Too many scan attempts. Wait a moment and try again.",
    },
    {
      status: 429,
      headers: {
        "Cache-Control": "no-store",
        "Retry-After": String(Math.max(1, limit.retryAfterSeconds)),
      },
    },
  );
}

interface GuestSummary {
  id: string;
  fullName: string;
  cardType: string;
}

interface AttendanceSnapshot {
  id: string;
  status: string;
  checkedInAt: Date | null;
}

function alreadyScannedResponse(guest: GuestSummary, attendance: AttendanceSnapshot) {
  return NextResponse.json({
    state: "already_scanned",
    guest,
    scannedAt: attendance.checkedInAt?.toISOString() ?? null,
    message: attendance.checkedInAt
      ? "This guest was already checked in."
      : "This guest is already checked in, but the original scan time is unavailable.",
  });
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

async function findAttendance(eventId: string, guestId: string) {
  return prisma.attendance.findFirst({
    where: { eventId, guestId },
    select: { id: true, status: true, checkedInAt: true },
  });
}

/**
 * Atomic event-day check-in (Step 11).
 *
 * The client sends only the decoded QR token. The server re-establishes every
 * boundary: session, event ownership, event authorization and token ownership.
 * Only the first valid scan for a guest writes CHECKED_IN. Duplicate and
 * concurrent scans return the first scan's stored timestamp instead of
 * overwriting it.
 */
export async function POST(request: Request, { params }: RouteContext) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(
        { state: "unauthorized", error: "Unauthorized" },
        { status: 401 },
      );
    }

    const { id: eventId } = await params;

    const userLimit = takeRateLimit(`scan:user:${session.userId}`, 600, 60 * 1000);
    if (!userLimit.allowed) return scanRateLimitResponse(userLimit);

    const ip = requestIp(request);
    if (ip) {
      const ipLimit = takeRateLimit(`scan:ip:${ip}`, 2_000, 60 * 1000);
      if (!ipLimit.allowed) return scanRateLimitResponse(ipLimit);
    }

    // Ownership is the event-level gate. STAFF users can scan an event only
    // when they own it until a staff-to-event assignment model exists.
    const event = await getOwnedEvent(eventId, session.userId);
    if (!event) {
      return NextResponse.json(
        { state: "event_not_found", error: "Event not found" },
        { status: 404 },
      );
    }
    if (event.status !== "AUTHORIZED") {
      return NextResponse.json(
        {
          state: "event_not_authorized",
          error: "This event must be authorized before tickets can be scanned.",
        },
        { status: 403 },
      );
    }

    const parsed = await readJsonBody(request, 8 * 1024);
    if (!parsed.ok) {
      return NextResponse.json(
        { state: "invalid_card", error: "Invalid request body." },
        { status: parsed.response.status === 413 ? 413 : 400 },
      );
    }

    const token = parsed.body.token;

    // Reject malformed input before touching guest data. A scanner may read
    // any QR code, so this is the first line of defence for non-ticket codes.
    if (!isValidQrTokenFormat(token)) {
      return NextResponse.json(
        { state: "invalid_card", error: "This QR code is not a valid ticket." },
        { status: 400 },
      );
    }

    // Resolve the token globally first so a genuine ticket from another event
    // produces the explicit wrong_event state. The other guest's name and
    // details are never included in that response.
    const guest = await prisma.guest.findUnique({
      where: { qrToken: token },
      select: {
        id: true,
        eventId: true,
        fullName: true,
        cardType: true,
        attendances: {
          where: { eventId },
          take: 1,
          select: { id: true, status: true, checkedInAt: true },
        },
      },
    });

    if (!guest) {
      return NextResponse.json(
        { state: "invalid_card", error: "This QR code is not a valid ticket." },
        { status: 404 },
      );
    }

    if (guest.eventId !== eventId) {
      return NextResponse.json(
        { state: "wrong_event", error: "This card belongs to a different event." },
        { status: 409 },
      );
    }

    const guestSummary: GuestSummary = {
      id: guest.id,
      fullName: guest.fullName,
      cardType: guest.cardType,
    };
    const existing = guest.attendances[0] ?? null;

    // checkedInAt is the durable marker of the first scan. A later status
    // change (for example LEFT) must not overwrite the original timestamp.
    if (existing && (existing.status === "CHECKED_IN" || existing.checkedInAt !== null)) {
      return alreadyScannedResponse(guestSummary, existing);
    }

    const scannedAt = new Date();

    if (existing) {
      // Atomic compare-and-set. If two requests race, the first update wins;
      // the second sees zero affected rows and reads the winner's timestamp.
      const update = await prisma.attendance.updateMany({
        where: {
          id: existing.id,
          status: { not: "CHECKED_IN" },
          checkedInAt: null,
        },
        data: {
          status: "CHECKED_IN",
          checkedInAt: scannedAt,
          checkedInById: session.userId,
        },
      });

      if (update.count === 0) {
        const latest = await findAttendance(eventId, guest.id);
        if (!latest) throw new Error("Attendance disappeared during check-in");
        return alreadyScannedResponse(guestSummary, latest);
      }
    } else {
      try {
        await prisma.attendance.create({
          data: {
            eventId,
            guestId: guest.id,
            status: "CHECKED_IN",
            checkedInAt: scannedAt,
            checkedInById: session.userId,
          },
        });
      } catch (error) {
        // The unique [eventId, guestId] constraint is the final guard when two
        // requests both observe no attendance row. The winner's row is the
        // authoritative scan; return its exact timestamp.
        if (!isUniqueConstraintError(error)) throw error;

        const latest = await findAttendance(eventId, guest.id);
        if (!latest) throw new Error("Attendance disappeared during check-in");
        return alreadyScannedResponse(guestSummary, latest);
      }
    }

    await recordAudit({
      actorId: session.userId,
      action: "attendance.checked_in",
      entityType: "guest",
      entityId: guest.id,
      metadata: {
        eventId,
        guestName: guest.fullName,
        source: "qr_scan",
        scannedAt: scannedAt.toISOString(),
      },
      ipAddress: clientIp(request),
    });

    return NextResponse.json({
      state: "success",
      guest: guestSummary,
      scannedAt: scannedAt.toISOString(),
      message: "Guest checked in successfully.",
    });
  } catch (error) {
    console.error("Ticket scan error:", error);
    return NextResponse.json(
      { state: "error", error: "Unable to check in this ticket." },
      { status: 500 },
    );
  }
}
