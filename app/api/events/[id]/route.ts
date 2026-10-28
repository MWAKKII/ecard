import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getOwnedEvent, getSession } from "@/lib/session";
import { parseEventStart, quoteForGuestCount } from "@/lib/events";
import { readJsonBody } from "@/lib/request";
import { takeRateLimit, rateLimitResponse } from "@/lib/rate-limit";

type RouteContext = { params: Promise<{ id: string }> };

const EVENT_TYPES = ["WEDDING", "CORPORATE", "OTHER"] as const;
const MAX_TITLE_LENGTH = 200;
const MAX_COUPLE_NAMES_LENGTH = 200;
const MAX_DESCRIPTION_LENGTH = 2_000;
const MAX_LOCATION_LENGTH = 200;
const MAX_GUEST_COUNT = 100_000;
const MAX_BODY_BYTES = 64 * 1024;

class PaymentLockedError extends Error {}

export async function GET(_request: Request, { params }: RouteContext) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    // Ownership boundary: a client can only read their own events (spec section 41).
    // One query returns the event, its pricing tier and the latest payment
    // (previously 3 sequential queries - each one is a full roundtrip).
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
 * Client event editing (Step 6 - "a client can only view and edit their
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

    const updateLimit = takeRateLimit(
      `events:update:${session.userId}`,
      60,
      60 * 1000,
    );
    if (!updateLimit.allowed) {
      return rateLimitResponse(updateLimit, "Too many event updates. Try again later.");
    }

    const parsed = await readJsonBody(request, MAX_BODY_BYTES);
    if (!parsed.ok) return parsed.response;
    const body = parsed.body;

    const updates: Record<string, unknown> = {};

    if (body.title !== undefined) {
      if (typeof body.title !== "string") {
        return NextResponse.json({ error: "Event title must be text" }, { status: 400 });
      }
      const title = body.title.trim();
      if (!title) {
        return NextResponse.json({ error: "Event title cannot be empty" }, { status: 400 });
      }
      if (title.length > MAX_TITLE_LENGTH) {
        return NextResponse.json(
          { error: `Event title must be ${MAX_TITLE_LENGTH} characters or fewer.` },
          { status: 400 },
        );
      }
      updates.title = title;
    }
    if (body.type !== undefined) {
      if (typeof body.type !== "string") {
        return NextResponse.json({ error: "Invalid event type" }, { status: 400 });
      }
      const type = body.type.toUpperCase();
      if (!(EVENT_TYPES as readonly string[]).includes(type)) {
        return NextResponse.json({ error: "Invalid event type" }, { status: 400 });
      }
      updates.type = type;
    }
    if (body.coupleNames !== undefined) {
      if (body.coupleNames !== null && typeof body.coupleNames !== "string") {
        return NextResponse.json({ error: "Couple names must be text" }, { status: 400 });
      }
      const coupleNames =
        typeof body.coupleNames === "string" ? body.coupleNames.trim() : "";
      if (coupleNames.length > MAX_COUPLE_NAMES_LENGTH) {
        return NextResponse.json(
          { error: `Couple names must be ${MAX_COUPLE_NAMES_LENGTH} characters or fewer.` },
          { status: 400 },
        );
      }
      updates.coupleNames = coupleNames || null;
    }
    if (body.description !== undefined) {
      if (body.description !== null && typeof body.description !== "string") {
        return NextResponse.json({ error: "Description must be text" }, { status: 400 });
      }
      const description =
        typeof body.description === "string" ? body.description.trim() : "";
      if (description.length > MAX_DESCRIPTION_LENGTH) {
        return NextResponse.json(
          { error: `Description must be ${MAX_DESCRIPTION_LENGTH} characters or fewer.` },
          { status: 400 },
        );
      }
      updates.description = description || null;
    }
    if (body.location !== undefined) {
      if (body.location !== null && typeof body.location !== "string") {
        return NextResponse.json({ error: "Location must be text" }, { status: 400 });
      }
      const location = typeof body.location === "string" ? body.location.trim() : "";
      if (location.length > MAX_LOCATION_LENGTH) {
        return NextResponse.json(
          { error: `Location must be ${MAX_LOCATION_LENGTH} characters or fewer.` },
          { status: 400 },
        );
      }
      updates.location = location || null;
    }
    if (body.date !== undefined || body.time !== undefined) {
      const startsAt = parseEventStart(body.date ?? null, body.time ?? null);
      if (!startsAt) {
        return NextResponse.json(
          { error: "A valid event date and time are required" },
          { status: 400 },
        );
      }
      updates.startsAt = startsAt;
    }

    if (body.cardTemplateId !== undefined) {
      if (body.cardTemplateId === null || body.cardTemplateId === "") {
        updates.cardTemplateId = null;
      } else {
        if (typeof body.cardTemplateId !== "string" || body.cardTemplateId.length > 64) {
          return NextResponse.json({ error: "Invalid card design." }, { status: 400 });
        }
        const design = await prisma.cardTemplate.findFirst({
          where: { id: body.cardTemplateId, status: "ACTIVE" },
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

    let guestCountUpdate: { guestCount: number; amount: number; tierId: string } | null = null;

    if (body.guestCount !== undefined) {
      const guestCount = Number(body.guestCount);
      if (
        !Number.isInteger(guestCount) ||
        guestCount < 1 ||
        guestCount > MAX_GUEST_COUNT
      ) {
        return NextResponse.json(
          { error: "A valid expected guest count is required" },
          { status: 400 },
        );
      }

      const quote = await quoteForGuestCount(guestCount);
      if (!quote) {
        return NextResponse.json(
          { error: "No active pricing tier covers that number of guests." },
          { status: 400 },
        );
      }

      guestCountUpdate = {
        guestCount,
        amount: quote.amount,
        tierId: quote.tierId,
      };
      updates.guestCount = guestCount;
      updates.quotedAmount = quote.amount;
      updates.pricingTierId = quote.tierId;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }

    try {
      const updated = await prisma.$transaction(async (tx) => {
        // Lock the quote only while the payment is still PENDING. The
        // conditional updateMany closes the race where a payment is submitted
        // after the pre-check but before this transaction updates the amount.
        if (guestCountUpdate) {
          const latestPayment = await tx.payment.findFirst({
            where: { eventId: event.id },
            orderBy: { createdAt: "desc" },
          });
          if (!latestPayment || latestPayment.status !== "PENDING") {
            throw new PaymentLockedError(
              "The guest count can no longer be changed because this payment has been submitted for review.",
            );
          }

          const locked = await tx.payment.updateMany({
            where: { id: latestPayment.id, status: "PENDING" },
            data: {
              amount: guestCountUpdate.amount,
              pricingTierId: guestCountUpdate.tierId,
            },
          });
          if (locked.count !== 1) {
            throw new PaymentLockedError(
              "The guest count can no longer be changed because this payment has been submitted for review.",
            );
          }
        }

        return tx.event.update({ where: { id: event.id }, data: updates });
      });

      return NextResponse.json({ success: true, event: updated });
    } catch (error: unknown) {
      if (error instanceof PaymentLockedError) {
        return NextResponse.json({ error: error.message }, { status: 409 });
      }
      throw error;
    }
  } catch (error) {
    console.error("Event update error:", error);
    return NextResponse.json({ error: "Unable to update event" }, { status: 500 });
  }
}
