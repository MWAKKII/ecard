import { NextResponse } from "next/server";
import type { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/session";
import { cleanPhone, CARD_TYPES, GUEST_PUBLIC_SELECT } from "@/lib/guests";
import { generateCardsForGuests } from "@/lib/card-generation";
import { recordAudit, clientIp } from "@/lib/audit";
import { readJsonBody } from "@/lib/request";

type RouteContext = { params: Promise<{ id: string; guestId: string }> };

// Admin repairs may immediately re-render the guest card.
export const maxDuration = 60;

/**
 * Admin correction of guest details.
 *
 * This is the admin counterpart to the owner-only guest PATCH route. It works
 * even when the event is suspended or not authorized because it exists for
 * data repair; the action is always audited. Name/quality changes invalidate
 * the cached PNG and are re-rendered immediately when an active design exists.
 */
export async function PATCH(request: Request, { params }: RouteContext) {
  try {
    const admin = await requireAdmin();
    if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id: eventId, guestId } = await params;
    const [event, guest] = await Promise.all([
      prisma.event.findUnique({
        where: { id: eventId },
        select: { id: true, title: true, ownerId: true, status: true },
      }),
      prisma.guest.findFirst({
        where: { id: guestId, eventId },
        select: {
          id: true,
          fullName: true,
          phone: true,
          whatsapp: true,
          cardType: true,
          cardStatus: true,
          deliveryStatus: true,
        },
      }),
    ]);
    if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });
    if (!guest) return NextResponse.json({ error: "Guest not found" }, { status: 404 });

    const parsed = await readJsonBody(request, 32 * 1024);
    if (!parsed.ok) return parsed.response;
    const body = parsed.body;

    const updates: Prisma.GuestUpdateInput = {};
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};

    if (body.fullName !== undefined) {
      if (typeof body.fullName !== "string") {
        return NextResponse.json({ error: "Guest name must be text." }, { status: 400 });
      }
      const fullName = body.fullName.trim();
      if (!fullName || fullName.length > 120) {
        return NextResponse.json(
          { error: "Guest name is required (max 120 characters)." },
          { status: 400 },
        );
      }
      if (fullName !== guest.fullName) {
        before.fullName = guest.fullName;
        after.fullName = fullName;
        updates.fullName = fullName;
      }
    }

    for (const field of ["phone", "whatsapp"] as const) {
      if (body[field] === undefined) continue;
      const cleaned = cleanPhone(body[field]);
      if (!cleaned.ok) return NextResponse.json({ error: cleaned.reason }, { status: 400 });
      if (cleaned.value !== guest[field]) {
        before[field] = guest[field];
        after[field] = cleaned.value;
        updates[field] = cleaned.value;
      }
    }

    if (body.cardType !== undefined) {
      if (typeof body.cardType !== "string") {
        return NextResponse.json({ error: "Card type must be STANDARD or PREMIUM." }, { status: 400 });
      }
      const cardType = body.cardType.toUpperCase();
      if (!(CARD_TYPES as readonly string[]).includes(cardType)) {
        return NextResponse.json({ error: "Card type must be STANDARD or PREMIUM." }, { status: 400 });
      }
      if (cardType !== guest.cardType) {
        before.cardType = guest.cardType;
        after.cardType = cardType;
        updates.cardType = cardType as (typeof CARD_TYPES)[number];
      }
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }

    const refreshCard = updates.fullName !== undefined || updates.cardType !== undefined;
    const resetDelivery =
      refreshCard || updates.phone !== undefined || updates.whatsapp !== undefined;
    if (resetDelivery) {
      before.deliveryStatus = guest.deliveryStatus;
      after.deliveryStatus = "NOT_SENT";
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
      },
      select: GUEST_PUBLIC_SELECT,
    });

    await recordAudit({
      actorId: admin.userId,
      action: "guest.admin_updated",
      entityType: "guest",
      entityId: guestId,
      metadata: {
        eventId,
        eventTitle: event.title,
        ownerId: event.ownerId,
        guestName: guest.fullName,
        before,
        after,
        source: "admin_override",
      },
      ipAddress: clientIp(request),
    });

    let cardGeneration: Awaited<ReturnType<typeof generateCardsForGuests>> | null = null;
    let responseGuest = updated;
    if (refreshCard) {
      // Admin repair is allowed for any event status as long as an active design
      // exists; generateCardsForGuests still requires the design itself.
      cardGeneration = await generateCardsForGuests(eventId, [guestId], {
        allowInactiveEvent: true,
      });
      const refreshed = await prisma.guest.findUnique({
        where: { id: guestId },
        select: GUEST_PUBLIC_SELECT,
      });
      if (refreshed) responseGuest = refreshed;
    }

    return NextResponse.json({ success: true, guest: responseGuest, cardGeneration });
  } catch (error) {
    console.error("Admin guest override error:", error);
    return NextResponse.json({ error: "Unable to update guest" }, { status: 500 });
  }
}
