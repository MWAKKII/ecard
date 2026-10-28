import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession, getOwnedEvent } from "@/lib/session";
import { GUEST_PUBLIC_SELECT, lockEventForGuestWrite, validateGuestRow } from "@/lib/guests";
import { generateCardsForGuests } from "@/lib/card-generation";
import { recordAudit, clientIp } from "@/lib/audit";
import { readJsonBody } from "@/lib/request";
import { takeRateLimit, rateLimitResponse } from "@/lib/rate-limit";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Guest list & single-guest creation (Step 8).
 * Hard business gate: guests only exist on AUTHORIZED events, and only for
 * the event owner (spec section 41).
 */
async function requireOwnedAuthorizedEvent(eventId: string) {
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
  return { session, event };
}

export async function GET(_request: Request, { params }: RouteContext) {
  try {
    const { id: eventId } = await params;
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // Single roundtrip: ownership + authorization gate + guest list.
    // qrToken is deliberately excluded — it is only obtainable via the QR
    // image endpoint, never serialized to list responses (Step 9).
    const event = await prisma.event.findFirst({
      where: { id: eventId, ownerId: session.userId },
      select: {
        status: true,
        guests: {
          select: {
            id: true,
            fullName: true,
            email: true,
            phone: true,
            whatsapp: true,
            cardType: true,
            cardStatus: true,
            deliveryStatus: true,
            deliveredAt: true,
            deliveryProvider: true,
            deliveryError: true,
            plusOnes: true,
            createdAt: true,
            attendances: true,
          },
          orderBy: { createdAt: "asc" },
        },
      },
    });

    if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });
    if (event.status !== "AUTHORIZED") {
      return NextResponse.json(
        { error: "This event must be authorized before guests can be managed" },
        { status: 403 },
      );
    }

    return NextResponse.json(event.guests);
  } catch (error) {
    console.error("Guest list error:", error);
    return NextResponse.json({ error: "Unable to load guests" }, { status: 500 });
  }
}

/** Create one guest (the import route handles batches). */
export async function POST(request: Request, { params }: RouteContext) {
  try {
    const { id: eventId } = await params;
    const gate = await requireOwnedAuthorizedEvent(eventId);
    if ("error" in gate) return gate.error;
    const { session, event } = gate;

    const limit = takeRateLimit(
      `guest:create:${session.userId}:${eventId}`,
      60,
      60 * 1000,
    );
    if (!limit.allowed) {
      return rateLimitResponse(limit, "Too many guest additions. Try again later.");
    }

    const parsed = await readJsonBody(request, 64 * 1024);
    if (!parsed.ok) return parsed.response;
    const body = parsed.body;

    const validated = validateGuestRow(body);
    if (!validated.ok) {
      return NextResponse.json({ error: validated.reason }, { status: 400 });
    }

    const outcome = await prisma.$transaction(async (tx) => {
      await lockEventForGuestWrite(tx, eventId);

      // Duplicate check against the event's existing list.
      const dupe = await tx.guest.findFirst({
        where: {
          eventId,
          OR: [
            { fullName: { equals: validated.row.fullName, mode: "insensitive" } },
            ...(validated.row.email ? [{ email: validated.row.email }] : []),
          ],
        },
        select: { id: true, fullName: true },
      });
      if (dupe) {
        return {
          ok: false as const,
          status: 409,
          error: `"${validated.row.fullName}" is already on the guest list.`,
        };
      }

    // Enforce the event's pricing-tier capacity: the "1-100" tier allows at
    // most 100 guests, "101-200" allows 200, and so on (spec — guest count
    // drives pricing, so the tier's range is the hard capacity).
      const [guestCount, tier] = await Promise.all([
        tx.guest.count({ where: { eventId } }),
        tx.pricingTier.findUnique({ where: { id: event.pricingTierId } }),
      ]);
      const capacity = tier?.maxGuests ?? event.guestCount;
      if (guestCount >= capacity) {
        const plan = tier
          ? `The ${tier.minGuests}-${tier.maxGuests} guest tier`
          : "This pricing plan";
        return {
          ok: false as const,
          status: 409,
          error:
            `${plan} allows up to ${capacity} guest(s) and this event already has ${guestCount}. ` +
            `Choose a larger tier to add more.`,
        };
      }

      const guest = await tx.guest.create({
        data: { eventId, ...validated.row },
        select: GUEST_PUBLIC_SELECT,
      });
      return { ok: true as const, guest };
    });

    if (!outcome.ok) {
      return NextResponse.json({ error: outcome.error }, { status: outcome.status });
    }
    const guest = outcome.guest;

    // Prepare the personalized card immediately with the event's selected,
    // active design. A rendering failure must not lose the guest — the card
    // endpoint will retry, and the guest simply stays PENDING.
    const cards = await generateCardsForGuests(eventId, [guest.id]);
    const created = await prisma.guest.findUnique({
      where: { id: guest.id },
      select: GUEST_PUBLIC_SELECT,
    });

    await recordAudit({
      actorId: session.userId,
      action: "guest.created",
      entityType: "guest",
      entityId: guest.id,
      metadata: {
        eventId,
        fullName: guest.fullName,
        cardType: guest.cardType,
        cardGenerated: cards.generated > 0,
      },
      ipAddress: clientIp(request),
    });

    return NextResponse.json(
      { ...(created ?? guest), cardGenerated: cards.generated > 0 },
      { status: 201 },
    );
  } catch (error) {
    console.error("Guest creation error:", error);
    return NextResponse.json({ error: "Unable to create guest" }, { status: 500 });
  }
}
