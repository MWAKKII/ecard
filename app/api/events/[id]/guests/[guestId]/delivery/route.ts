import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getOwnedEvent, getSession } from "@/lib/session";
import { generateCardsForGuests } from "@/lib/card-generation";
import { clientIp, recordAudit } from "@/lib/audit";
import { takeRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import {
  getWhatsAppDeliveryConfig,
  sendWhatsAppCard,
  WHATSAPP_NOT_CONFIGURED_MESSAGE as NOT_CONFIGURED_MESSAGE,
  type WhatsAppDeliveryConfig,
} from "@/lib/whatsapp-delivery";

type RouteContext = { params: Promise<{ id: string; guestId: string }> };

// Rendering + provider upload + WhatsApp API call may take longer than a
// default short function timeout.
export const maxDuration = 60;

function publicConfig(config: WhatsAppDeliveryConfig) {
  return { configured: config.configured, provider: config.provider, mode: config.mode };
}

function deliveryPayload(guest: {
  deliveryStatus: string;
  deliveredAt: Date | null;
  deliveryProvider: string | null;
  deliveryMessageId: string | null;
  deliveryError: string | null;
}) {
  return {
    status: guest.deliveryStatus,
    deliveredAt: guest.deliveredAt?.toISOString() ?? null,
    provider: guest.deliveryProvider,
    messageId: guest.deliveryMessageId,
    error: guest.deliveryError,
  };
}

function safeCardFileName(fullName: string): string {
  const slug =
    fullName
      .normalize("NFKD")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .toLowerCase() || "guest";
  return `card-${slug}.png`;
}

/**
 * Load the owner + authorized event + guest. Deliberately does not select
 * cardPng here: card bytes are only loaded after generation.
 */
async function loadContext(eventId: string, guestId: string) {
  const session = await getSession();
  if (!session) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const event = await getOwnedEvent(eventId, session.userId);
  if (!event) {
    return { error: NextResponse.json({ error: "Event not found" }, { status: 404 }) };
  }
  if (event.status !== "AUTHORIZED") {
    return {
      error: NextResponse.json(
        { error: "This event must be authorized before cards can be delivered" },
        { status: 403 },
      ),
    };
  }

  const guest = await prisma.guest.findFirst({
    where: { id: guestId, eventId },
    select: {
      id: true,
      fullName: true,
      whatsapp: true,
      phone: true,
      deliveryStatus: true,
      deliveredAt: true,
      deliveryProvider: true,
      deliveryMessageId: true,
      deliveryError: true,
      event: {
        select: {
          title: true,
          cardTemplate: { select: { status: true } },
        },
      },
    },
  });
  if (!guest) {
    return { error: NextResponse.json({ error: "Guest not found" }, { status: 404 }) };
  }

  return { session, event, guest };
}

/** Provider configuration + the guest's current delivery state. */
export async function GET(_request: Request, { params }: RouteContext) {
  try {
    const { id: eventId, guestId } = await params;
    const gate = await loadContext(eventId, guestId);
    if ("error" in gate) return gate.error;

    return NextResponse.json(
      {
        whatsapp: publicConfig(getWhatsAppDeliveryConfig()),
        delivery: deliveryPayload(gate.guest),
        hasRecipient: Boolean((gate.guest.whatsapp || gate.guest.phone || "").replace(/\D/g, "")),
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    console.error("Card delivery status error:", error);
    return NextResponse.json({ error: "Unable to check card delivery" }, { status: 500 });
  }
}

/**
 * Send the personalized card through WhatsApp.
 *
 * There is intentionally no client-side "I shared it" path: only the provider
 * service can confirm a send, and the guest is marked SENT only after it does.
 * Without provider credentials this returns 503 and records NOT_CONFIGURED.
 */
export async function POST(request: Request, { params }: RouteContext) {
  try {
    const { id: eventId, guestId } = await params;
    const gate = await loadContext(eventId, guestId);
    if ("error" in gate) return gate.error;

    const { session, guest } = gate;

    // WhatsApp delivery can cost money and trigger provider abuse controls.
    // Limit repeated attempts per guest and total sends per account.
    const guestLimit = takeRateLimit(
      `delivery:guest:${session.userId}:${guestId}`,
      5,
      10 * 60 * 1000,
    );
    if (!guestLimit.allowed) {
      return rateLimitResponse(guestLimit, "Too many delivery attempts for this guest. Try again later.");
    }

    const userLimit = takeRateLimit(`delivery:user:${session.userId}`, 300, 60 * 60 * 1000);
    if (!userLimit.allowed) {
      return rateLimitResponse(userLimit, "Too many card deliveries. Try again later.");
    }

    const config = getWhatsAppDeliveryConfig();

    if (!config.configured) {
      await prisma.guest.update({
        where: { id: guestId },
        data: {
          deliveryStatus: "NOT_CONFIGURED",
          deliveredAt: null,
          deliveryProvider: null,
          deliveryMessageId: null,
          deliveryError: NOT_CONFIGURED_MESSAGE,
        },
      });
      await recordAudit({
        actorId: session.userId,
        action: "guest.card_delivery_not_configured",
        entityType: "guest",
        entityId: guestId,
        metadata: { eventId, missing: config.missing },
        ipAddress: clientIp(request),
      });
      return NextResponse.json(
        {
          error: NOT_CONFIGURED_MESSAGE,
          code: "WHATSAPP_NOT_CONFIGURED",
          deliveryStatus: "NOT_CONFIGURED",
          whatsapp: publicConfig(config),
          delivery: {
            status: "NOT_CONFIGURED",
            deliveredAt: null,
            provider: null,
            messageId: null,
            error: NOT_CONFIGURED_MESSAGE,
          },
        },
        { status: 503 },
      );
    }

    const recipient = (guest.whatsapp || guest.phone || "").replace(/\D/g, "");
    if (recipient.length < 7 || recipient.length > 15) {
      const message = "This guest does not have a valid WhatsApp number.";
      await prisma.guest.update({
        where: { id: guestId },
        data: {
          deliveryStatus: "FAILED",
          deliveredAt: null,
          deliveryProvider: config.provider,
          deliveryMessageId: null,
          deliveryError: message,
        },
      });
      await recordAudit({
        actorId: session.userId,
        action: "guest.card_delivery_failed",
        entityType: "guest",
        entityId: guestId,
        metadata: { eventId, reason: "invalid-recipient" },
        ipAddress: clientIp(request),
      });
      return NextResponse.json(
        {
          error: message,
          code: "INVALID_RECIPIENT",
          deliveryStatus: "FAILED",
          whatsapp: publicConfig(config),
          delivery: {
            status: "FAILED",
            deliveredAt: null,
            provider: config.provider,
            messageId: null,
            error: message,
          },
        },
        { status: 400 },
      );
    }

    if (guest.event.cardTemplate?.status !== "ACTIVE") {
      const message =
        "Choose an active card design for this event before sending cards through WhatsApp.";
      await prisma.guest.update({
        where: { id: guestId },
        data: {
          deliveryStatus: "FAILED",
          deliveredAt: null,
          deliveryProvider: config.provider,
          deliveryMessageId: null,
          deliveryError: message,
        },
      });
      return NextResponse.json(
        {
          error: message,
          code: "CARD_NOT_READY",
          deliveryStatus: "FAILED",
          whatsapp: publicConfig(config),
          delivery: {
            status: "FAILED",
            deliveredAt: null,
            provider: config.provider,
            messageId: null,
            error: message,
          },
        },
        { status: 409 },
      );
    }

    // Re-render from the current design/title/guest details, then read the
    // cached bytes. A cached card is used if a transient render still fails.
    await generateCardsForGuests(eventId, [guestId]);
    const card = await prisma.guest.findUnique({
      where: { id: guestId },
      select: { cardPng: true, fullName: true },
    });
    if (!card?.cardPng) {
      const message = "The personalized card could not be generated, so nothing was sent.";
      await prisma.guest.update({
        where: { id: guestId },
        data: {
          deliveryStatus: "FAILED",
          deliveredAt: null,
          deliveryProvider: config.provider,
          deliveryMessageId: null,
          deliveryError: message,
        },
      });
      await recordAudit({
        actorId: session.userId,
        action: "guest.card_delivery_failed",
        entityType: "guest",
        entityId: guestId,
        metadata: { eventId, reason: "card-generation" },
        ipAddress: clientIp(request),
      });
      return NextResponse.json(
        {
          error: message,
          code: "CARD_NOT_READY",
          deliveryStatus: "FAILED",
          whatsapp: publicConfig(config),
          delivery: {
            status: "FAILED",
            deliveredAt: null,
            provider: config.provider,
            messageId: null,
            error: message,
          },
        },
        { status: 409 },
      );
    }

    const result = await sendWhatsAppCard({
      to: recipient,
      png: new Uint8Array(card.cardPng),
      fileName: safeCardFileName(card.fullName),
      caption: `Hi ${card.fullName}, here is your card for ${guest.event.title}.`,
      guestName: card.fullName,
      eventTitle: guest.event.title,
    });

    if (!result.ok) {
      const status = result.code === "NOT_CONFIGURED" ? "NOT_CONFIGURED" : "FAILED";
      const updated = await prisma.guest.update({
        where: { id: guestId },
        data: {
          deliveryStatus: status,
          deliveredAt: null,
          deliveryProvider: result.provider,
          deliveryMessageId: null,
          deliveryError: result.message,
        },
      });
      await recordAudit({
        actorId: session.userId,
        action:
          status === "NOT_CONFIGURED"
            ? "guest.card_delivery_not_configured"
            : "guest.card_delivery_failed",
        entityType: "guest",
        entityId: guestId,
        metadata: { eventId, code: result.code, provider: result.provider },
        ipAddress: clientIp(request),
      });

      return NextResponse.json(
        {
          error: result.message,
          code: result.code === "NOT_CONFIGURED" ? "WHATSAPP_NOT_CONFIGURED" : result.code,
          deliveryStatus: status,
          whatsapp: publicConfig(getWhatsAppDeliveryConfig()),
          delivery: deliveryPayload(updated),
        },
        { status: status === "NOT_CONFIGURED" ? 503 : 502 },
      );
    }

    const deliveredAt = new Date();
    const updated = await prisma.guest.update({
      where: { id: guestId },
      data: {
        deliveryStatus: "SENT",
        deliveredAt,
        deliveryProvider: result.provider,
        deliveryMessageId: result.messageId,
        deliveryError: null,
      },
      select: {
        deliveryStatus: true,
        deliveredAt: true,
        deliveryProvider: true,
        deliveryMessageId: true,
        deliveryError: true,
      },
    });

    await recordAudit({
      actorId: session.userId,
      action: "guest.card_delivered",
      entityType: "guest",
      entityId: guestId,
      metadata: {
        eventId,
        provider: result.provider,
        messageId: result.messageId,
      },
      ipAddress: clientIp(request),
    });

    return NextResponse.json({
      deliveryStatus: "SENT",
      whatsapp: publicConfig(config),
      delivery: deliveryPayload(updated),
    });
  } catch (error) {
    console.error("Card delivery error:", error);
    return NextResponse.json({ error: "Unable to deliver the card" }, { status: 500 });
  }
}
