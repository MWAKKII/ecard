import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession, getOwnedEvent } from "@/lib/session";
import { validateGuestRow } from "@/lib/guests";
import { recordAudit, clientIp } from "@/lib/audit";

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
    const gate = await requireOwnedAuthorizedEvent(eventId);
    if ("error" in gate) return gate.error;

    // qrToken is deliberately excluded — it is only obtainable via the QR
    // image endpoint, never serialized to list responses (Step 9).
    const guests = await prisma.guest.findMany({
      where: { eventId },
      select: {
        id: true,
        fullName: true,
        email: true,
        phone: true,
        whatsapp: true,
        cardType: true,
        cardStatus: true,
        plusOnes: true,
        createdAt: true,
        attendances: true,
      },
      orderBy: { createdAt: "asc" },
    });

    return NextResponse.json(guests);
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

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const validated = validateGuestRow(body);
    if (!validated.ok) {
      return NextResponse.json({ error: validated.reason }, { status: 400 });
    }

    // Duplicate check against the event's existing list.
    const dupe = await prisma.guest.findFirst({
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
      return NextResponse.json(
        { error: `"${validated.row.fullName}" is already on the guest list.` },
        { status: 409 },
      );
    }

    // Enforce the event's pricing-tier capacity: the "1-100" tier allows at
    // most 100 guests, "101-200" allows 200, and so on (spec — guest count
    // drives pricing, so the tier's range is the hard capacity).
    const [guestCount, tier] = await Promise.all([
      prisma.guest.count({ where: { eventId } }),
      prisma.pricingTier.findUnique({ where: { id: event.pricingTierId } }),
    ]);
    const capacity = tier?.maxGuests ?? event.guestCount;
    if (guestCount >= capacity) {
      const plan = tier ? `The ${tier.minGuests}-${tier.maxGuests} guest tier` : "This pricing plan";
      return NextResponse.json(
        {
          error:
            `${plan} allows up to ${capacity} guest(s) and this event already has ${guestCount}. ` +
            `Choose a larger tier to add more.`,
        },
        { status: 409 },
      );
    }

    const guest = await prisma.guest.create({ data: { eventId, ...validated.row } });

    await recordAudit({
      actorId: session.userId,
      action: "guest.created",
      entityType: "guest",
      entityId: guest.id,
      metadata: { eventId, fullName: guest.fullName, cardType: guest.cardType },
      ipAddress: clientIp(request),
    });

    return NextResponse.json(guest, { status: 201 });
  } catch (error) {
    console.error("Guest creation error:", error);
    return NextResponse.json({ error: "Unable to create guest" }, { status: 500 });
  }
}
