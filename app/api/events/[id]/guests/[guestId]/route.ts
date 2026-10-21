import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession, getOwnedEvent } from "@/lib/session";
import { cleanPhone, CARD_TYPES } from "@/lib/guests";
import { recordAudit, clientIp } from "@/lib/audit";

type RouteContext = { params: Promise<{ id: string; guestId: string }> };

/**
 * Guest edit / delete (Step 8).
 * - Only the owner of an AUTHORIZED event may touch guests.
 * - Deleting a CHECKED_IN guest is blocked (attendance history is evidence).
 * - All mutations are audited (spec section 15).
 */
async function loadContext(eventId: string, guestId: string) {
  const session = await getSession();
  if (!session) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };

  const event = await getOwnedEvent(eventId, session.userId);
  if (!event) return { error: NextResponse.json({ error: "Event not found" }, { status: 404 }) };
  if (event.status !== "AUTHORIZED") {
    return {
      error: NextResponse.json(
        { error: "This event must be authorized before guests can be managed" },
        { status: 403 },
      ),
    };
  }

  const guest = await prisma.guest.findFirst({
    where: { id: guestId, eventId },
    include: { attendances: true },
  });
  if (!guest) return { error: NextResponse.json({ error: "Guest not found" }, { status: 404 }) };

  return { session, event, guest };
}

export async function PATCH(request: Request, { params }: RouteContext) {
  try {
    const { id: eventId, guestId } = await params;
    const gate = await loadContext(eventId, guestId);
    if ("error" in gate) return gate.error;
    const { session, guest } = gate;

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const updates: Record<string, unknown> = {};
    const before: Record<string, unknown> = {};

    if (body.fullName !== undefined) {
      const fullName = String(body.fullName).trim();
      if (!fullName || fullName.length > 120) {
        return NextResponse.json({ error: "Guest name is required (max 120 characters)." }, { status: 400 });
      }
      if (fullName !== guest.fullName) {
        before.fullName = guest.fullName;
        updates.fullName = fullName;
      }
    }

    for (const field of ["phone", "whatsapp"] as const) {
      if (body[field] !== undefined) {
        const cleaned = cleanPhone(body[field]);
        if (!cleaned.ok) {
          return NextResponse.json({ error: cleaned.reason }, { status: 400 });
        }
        if (cleaned.value !== guest[field]) {
          before[field] = guest[field];
          updates[field] = cleaned.value;
        }
      }
    }

    if (body.email !== undefined) {
      const email = String(body.email).trim().toLowerCase() || null;
      if (email && email.length > 254) {
        return NextResponse.json({ error: "Email address is too long." }, { status: 400 });
      }
      if (email !== guest.email) {
        const dupe = email
          ? await prisma.guest.findFirst({
              where: { eventId, email, id: { not: guestId } },
              select: { id: true },
            })
          : null;
        if (dupe) {
          return NextResponse.json({ error: "Another guest with that email is already on the list." }, { status: 409 });
        }
        before.email = guest.email;
        updates.email = email;
      }
    }

    if (body.cardType !== undefined) {
      const cardType = String(body.cardType).toUpperCase();
      if (!(CARD_TYPES as readonly string[]).includes(cardType)) {
        return NextResponse.json({ error: "Card type must be STANDARD or PREMIUM." }, { status: 400 });
      }
      if (cardType !== guest.cardType) {
        before.cardType = guest.cardType;
        updates.cardType = cardType;
      }
    }

    if (body.cardStatus !== undefined) {
      const cardStatus = String(body.cardStatus).toUpperCase();
      if (!["PENDING", "GENERATED", "SENT"].includes(cardStatus)) {
        return NextResponse.json({ error: "Invalid card status." }, { status: 400 });
      }
      if (cardStatus !== guest.cardStatus) {
        before.cardStatus = guest.cardStatus;
        updates.cardStatus = cardStatus;
      }
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }

    const updated = await prisma.guest.update({ where: { id: guestId }, data: updates });

    await recordAudit({
      actorId: session.userId,
      action: "guest.updated",
      entityType: "guest",
      entityId: guestId,
      metadata: { eventId, before, after: updates },
      ipAddress: clientIp(request),
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error("Guest update error:", error);
    return NextResponse.json({ error: "Unable to update guest" }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: RouteContext) {
  try {
    const { id: eventId, guestId } = await params;
    const gate = await loadContext(eventId, guestId);
    if ("error" in gate) return gate.error;
    const { session, guest } = gate;

    const checkedIn = guest.attendances.some((a) => a.status === "CHECKED_IN");
    if (checkedIn) {
      return NextResponse.json(
        { error: "This guest has already checked in and cannot be deleted." },
        { status: 409 },
      );
    }

    await prisma.guest.delete({ where: { id: guestId } });

    await recordAudit({
      actorId: session.userId,
      action: "guest.deleted",
      entityType: "guest",
      entityId: guestId,
      metadata: { eventId, fullName: guest.fullName },
      ipAddress: clientIp(request),
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Guest deletion error:", error);
    return NextResponse.json({ error: "Unable to delete guest" }, { status: 500 });
  }
}
