import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { buildEventSlug, parseEventStart, quoteForGuestCount } from "@/lib/events";

const EVENT_TYPES = ["WEDDING", "CORPORATE", "OTHER"] as const;

export async function GET() {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const events = await prisma.event.findMany({
      where: { ownerId: session.userId },
      include: {
        cardTemplate: true,
        pricingTier: true,
        payments: { orderBy: { createdAt: "desc" }, take: 1 },
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json(events, { status: 200 });
  } catch (error: unknown) {
    console.error("Event list error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * Client event creation (Step 6).
 * The pricing tier is selected and quoted on the server; the event starts
 * with paymentStatus=PENDING (embedded payment record) and
 * authorizationStatus=PENDING (event status stays DRAFT).
 */
export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await request.json();
    const title = typeof body.title === "string" ? body.title.trim() : "";
    const coupleNames = typeof body.coupleNames === "string" ? body.coupleNames.trim() : "";
    const description = typeof body.description === "string" ? body.description.trim() : "";
    const location = typeof body.location === "string" ? body.location.trim() : "";
    const type = typeof body.type === "string" ? body.type.toUpperCase() : "";
    const expectedGuests = Number(body.guestCount);
    const startsAt = parseEventStart(body.date, body.time);

    if (!(EVENT_TYPES as readonly string[]).includes(type)) {
      return NextResponse.json({ error: "Please select a valid event type (Wedding, Corporate or Other)." }, { status: 400 });
    }
    if (!title) {
      return NextResponse.json({ error: "Event title is required" }, { status: 400 });
    }
    if (type === "WEDDING" && !coupleNames) {
      return NextResponse.json({ error: "Couple names are required for wedding events" }, { status: 400 });
    }
    if (!Number.isInteger(expectedGuests) || expectedGuests < 1) {
      return NextResponse.json({ error: "A valid expected guest count is required" }, { status: 400 });
    }
    if (!startsAt) {
      return NextResponse.json({ error: "Event date and time are required" }, { status: 400 });
    }

    // Server-side price calculation — never trust a client-supplied amount.
    const quote = await quoteForGuestCount(expectedGuests);
    if (!quote) {
      return NextResponse.json({ error: "No active pricing tier covers that number of guests." }, { status: 400 });
    }

    const newEvent = await prisma.event.create({
      data: {
        title,
        type: type as (typeof EVENT_TYPES)[number],
        coupleNames: type === "WEDDING" ? coupleNames : null,
        slug: buildEventSlug(title),
        description: description || null,
        location: location || null,
        startsAt,
        quotedAmount: quote.amount,
        paymentInstructions: "Submit your payment reference after completing the offline payment instructions provided by the administrator.",
        guestCount: expectedGuests,
        status: "DRAFT", // authorizationStatus = PENDING
        owner: {
          connect: { id: session.userId },
        },
        pricingTier: {
          connect: { id: quote.tierId },
        },
        payments: {
          create: {
            userId: session.userId,
            pricingTierId: quote.tierId,
            amount: quote.amount,
            currency: "TSH",
            status: "PENDING", // paymentStatus = PENDING
          },
        },
        ...(body.cardTemplateId && { cardTemplateId: body.cardTemplateId }),
      },
    });

    return NextResponse.json({ success: true, event: newEvent }, { status: 201 });
  } catch (error: unknown) {
    console.error("Event creation error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
