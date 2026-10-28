import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { buildEventSlug, parseEventStart, quoteForGuestCount } from "@/lib/events";
import { readJsonBody } from "@/lib/request";
import { takeRateLimit, rateLimitResponse } from "@/lib/rate-limit";

const EVENT_TYPES = ["WEDDING", "CORPORATE", "OTHER"] as const;
const MAX_TITLE_LENGTH = 200;
const MAX_COUPLE_NAMES_LENGTH = 200;
const MAX_DESCRIPTION_LENGTH = 2_000;
const MAX_LOCATION_LENGTH = 200;
const MAX_GUEST_COUNT = 100_000;
const MAX_BODY_BYTES = 64 * 1024;

export async function GET() {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // Only the fields the event list renders. Deliberately no cardTemplate
    // (it carries a base64 image) and no pricingTier - including them cost
    // extra roundtrips and could add megabytes to the response.
    const events = await prisma.event.findMany({
      where: { ownerId: session.userId },
      select: {
        id: true,
        title: true,
        description: true,
        type: true,
        status: true,
        startsAt: true,
        location: true,
        guestCount: true,
        quotedAmount: true,
        createdAt: true,
        payments: {
          select: { status: true },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
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

    const createLimit = takeRateLimit(
      `events:create:${session.userId}`,
      20,
      60 * 60 * 1000,
    );
    if (!createLimit.allowed) {
      return rateLimitResponse(createLimit, "Too many event creations. Try again later.");
    }

    const parsed = await readJsonBody(request, MAX_BODY_BYTES);
    if (!parsed.ok) return parsed.response;
    const body = parsed.body;

    const title = typeof body.title === "string" ? body.title.trim() : "";
    const coupleNames = typeof body.coupleNames === "string" ? body.coupleNames.trim() : "";
    const description = typeof body.description === "string" ? body.description.trim() : "";
    const location = typeof body.location === "string" ? body.location.trim() : "";
    const type = typeof body.type === "string" ? body.type.toUpperCase() : "";
    const expectedGuests = Number(body.guestCount);
    const startsAt = parseEventStart(body.date, body.time);

    if (!(EVENT_TYPES as readonly string[]).includes(type)) {
      return NextResponse.json(
        { error: "Please select a valid event type (Wedding, Corporate or Other)." },
        { status: 400 },
      );
    }
    if (!title) {
      return NextResponse.json({ error: "Event title is required" }, { status: 400 });
    }
    if (title.length > MAX_TITLE_LENGTH) {
      return NextResponse.json(
        { error: `Event title must be ${MAX_TITLE_LENGTH} characters or fewer.` },
        { status: 400 },
      );
    }
    if (coupleNames.length > MAX_COUPLE_NAMES_LENGTH) {
      return NextResponse.json(
        { error: `Couple names must be ${MAX_COUPLE_NAMES_LENGTH} characters or fewer.` },
        { status: 400 },
      );
    }
    if (description.length > MAX_DESCRIPTION_LENGTH) {
      return NextResponse.json(
        { error: `Description must be ${MAX_DESCRIPTION_LENGTH} characters or fewer.` },
        { status: 400 },
      );
    }
    if (location.length > MAX_LOCATION_LENGTH) {
      return NextResponse.json(
        { error: `Location must be ${MAX_LOCATION_LENGTH} characters or fewer.` },
        { status: 400 },
      );
    }
    if (type === "WEDDING" && !coupleNames) {
      return NextResponse.json(
        { error: "Couple names are required for wedding events" },
        { status: 400 },
      );
    }
    if (
      !Number.isInteger(expectedGuests) ||
      expectedGuests < 1 ||
      expectedGuests > MAX_GUEST_COUNT
    ) {
      return NextResponse.json({ error: "A valid expected guest count is required" }, { status: 400 });
    }
    if (!startsAt) {
      return NextResponse.json(
        { error: "Event date and time are required" },
        { status: 400 },
      );
    }

    let cardTemplateId: string | null = null;
    if (body.cardTemplateId !== undefined && body.cardTemplateId !== null && body.cardTemplateId !== "") {
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
      cardTemplateId = design.id;
    }

    // Server-side price calculation - never trust a client-supplied amount.
    const quote = await quoteForGuestCount(expectedGuests);
    if (!quote) {
      return NextResponse.json(
        { error: "No active pricing tier covers that number of guests." },
        { status: 400 },
      );
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
        paymentInstructions:
          "Submit your payment reference after completing the offline payment instructions provided by the administrator.",
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
        ...(cardTemplateId ? { cardTemplate: { connect: { id: cardTemplateId } } } : {}),
      },
    });

    return NextResponse.json({ success: true, event: newEvent }, { status: 201 });
  } catch (error: unknown) {
    console.error("Event creation error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
