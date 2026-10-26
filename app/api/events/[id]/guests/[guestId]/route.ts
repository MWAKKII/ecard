import { NextResponse } from "next/server";
import type { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getSession, getOwnedEvent } from "@/lib/session";
import { cleanPhone, CARD_TYPES, GUEST_PUBLIC_SELECT } from "@/lib/guests";
import { generateCardsForGuests } from "@/lib/card-generation";
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

  // Deliberately avoid cardPng/qrToken here: they are large/private and this
  // context is only used for validation, auditing and attendance checks.
  const guest = await prisma.guest.findFirst({
    where: { id: guestId, eventId },
    select: {
      id: true,
      fullName: true,
      phone: true,
      whatsapp: true,
      email: true,
      cardType: true,
      cardStatus: true,
      deliveryStatus: true,
      deliveredAt: true,
      deliveryProvider: true,
      deliveryError: true,
      attendances: true,
    },
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

    // Status is server-owned: generation follows rendering, and delivery
    // follows provider confirmation. Clients cannot mark a card as sent.
    if (body.cardStatus !== undefined || body.deliveryStatus !== undefined) {
      return NextResponse.json(
        { error: "Card and delivery status are managed by the server." },
        { status: 400 },
      );
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

    // cardStatus is managed by the generation service. Delivery status is
    // managed only by the WhatsApp delivery route after provider confirmation,
    // so neither can be set by a client PATCH.

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }

    // The card prints the guest's name and quality, so those edits invalidate
    // the cached PNG. Re-render immediately. Changing the card content or the
    // recipient also means the previously delivered card is no longer the
    // current card, so reset delivery to NOT_SENT.
    const refreshCard = updates.fullName !== undefined || updates.cardType !== undefined;
    const resetDelivery =
      refreshCard || updates.whatsapp !== undefined || updates.phone !== undefined;
    if (resetDelivery) {
      before.deliveryStatus = guest.deliveryStatus;
    }
    const updated = await prisma.guest.update({
      where: { id: guestId },
      data: {
        ...updates,
        ...(refreshCard ? { cardPng: null, cardFingerprint: null } : {}),
        ...(resetDelivery
          ? {
              deliveryStatus: "NOT_SENT",
              deliveredAt: null,
              deliveryProvider: null,
              deliveryMessageId: null,
              deliveryError: null,
            }
          : {}),
      } as Prisma.GuestUpdateInput,
      select: GUEST_PUBLIC_SELECT,
    });

    await recordAudit({
      actorId: session.userId,
      action: "guest.updated",
      entityType: "guest",
      entityId: guestId,
      metadata: { eventId, before, after: updates },
      ipAddress: clientIp(request),
    });

    if (refreshCard) {
      await generateCardsForGuests(eventId, [guestId]);
      const refreshed = await prisma.guest.findUnique({
        where: { id: guestId },
        select: GUEST_PUBLIC_SELECT,
      });
      return NextResponse.json(refreshed ?? updated);
    }

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
