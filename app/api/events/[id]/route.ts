import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getOwnedEvent, getSession } from "@/lib/session";
import { parseEventStart, quoteForGuestCount } from "@/lib/events";

type RouteContext = { params: Promise<{ id: string }> };

const EVENT_TYPES = ["WEDDING", "CORPORATE", "OTHER"] as const;

export async function GET(_request: Request, { params }: RouteContext) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    // Ownership boundary: a client can only read their own events (spec section 41).
    // One query returns the event, its pricing tier and the latest payment
    // (previously 3 sequential queries — each one is a full roundtrip).
    const event = await prisma.event.findFirst({
      where: { id, ownerId: session.userId },
      include: {
        pricingTier: true,
        payments: { orderBy: { createdAt: "desc" }, take: 1 },
      },
    });
    if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });

    return NextResponse.json(event);
  } catch (error) {
    console.error("Event details error:", error);
    return NextResponse.json({ error: "Unable to load event" }, { status: 500 });
  }
}

/**
 * Client event editing (Step 6 — "a client can only view and edit their
 * own events"). Changing the guest count re-quotes the price on the server,
 * but only while the payment is still PENDING; once a payment has been
 * submitted for review the quoted amount is locked.
 */
export async function PATCH(request: Request, { params }: RouteContext) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    const event = await getOwnedEvent(id, session.userId);
    if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });

    const body = await request.json();

    const updates: Record<string, unknown> = {};

    if (body.title !== undefined) {
      const title = String(body.title).trim();
      if (!title) return NextResponse.json({ error: "Event title cannot be empty" }, { status: 400 });
      updates.title = title;
    }
    if (body.type !== undefined) {
      const type = String(body.type).toUpperCase();
      if (!(EVENT_TYPES as readonly string[]).includes(type)) {
        return NextResponse.json({ error: "Invalid event type" }, { status: 400 });
      }
      updates.type = type;
    }
    if (body.coupleNames !== undefined) {
      updates.coupleNames = String(body.coupleNames).trim() || null;
    }
    if (body.description !== undefined) {
      updates.description = String(body.description).trim() || null;
    }
    if (body.location !== undefined) {
      updates.location = String(body.location).trim() || null;
    }
    if (body.date !== undefined || body.time !== undefined) {
      const startsAt = parseEventStart(body.date ?? null, body.time ?? null);
      if (!startsAt) return NextResponse.json({ error: "A valid event date and time are required" }, { status: 400 });
      updates.startsAt = startsAt;
    }

    if (body.cardTemplateId !== undefined) {
      if (body.cardTemplateId === null || body.cardTemplateId === "") {
        updates.cardTemplateId = null;
      } else {
        const cardTemplateId = String(body.cardTemplateId);
        const design = await prisma.cardTemplate.findFirst({
          where: { id: cardTemplateId, status: "ACTIVE" },
          select: { id: true },
        });
        if (!design) {
          return NextResponse.json(
            { error: "That card design is not available. Pick an active design." },
            { status: 400 },
          );
        }
        if (design.id !== event.cardTemplateId) updates.cardTemplateId = design.id;
      }
    }

    let payment = await prisma.payment.findFirst({
      where: { eventId: event.id },
      orderBy: { createdAt: "desc" },
    });

    if (body.guestCount !== undefined) {
      const guestCount = Number(body.guestCount);
      if (!Number.isInteger(guestCount) || guestCount < 1) {
        return NextResponse.json({ error: "A valid expected guest count is required" }, { status: 400 });
      }

      if (payment && payment.status !== "PENDING") {
        return NextResponse.json(
          { error: "The guest count can no longer be changed because this payment has been submitted for review." },
          { status: 409 },
        );
      }

      const quote = await quoteForGuestCount(guestCount);
      if (!quote) {
        return NextResponse.json({ error: "No active pricing tier covers that number of guests." }, { status: 400 });
      }

      updates.guestCount = guestCount;
      updates.quotedAmount = quote.amount;
      updates.pricingTierId = quote.tierId;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.event.update({ where: { id: event.id }, data: updates });
      if (updates.quotedAmount !== undefined && payment) {
        payment = await tx.payment.update({
          where: { id: payment.id },
          data: { amount: updates.quotedAmount as number, pricingTierId: updates.pricingTierId as string },
        });
      }
      return result;
    });

    return NextResponse.json({ success: true, event: updated });
  } catch (error) {
    console.error("Event update error:", error);
    return NextResponse.json({ error: "Unable to update event" }, { status: 500 });
  }
}
