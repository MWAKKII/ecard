import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { renderGuestCard } from "@/lib/card-render";
import { buildCardFingerprint, resolveTemplateLayout } from "@/lib/card-generation";

type RouteContext = { params: Promise<{ id: string; guestId: string }> };

/**
 * Personalized e-card PNG for one guest (spec Step 8).
 *
 * Composition: event's card template + event title + guest name + the guest's
 * opaque QR token + the guest's STANDARD/PREMIUM quality. The token is random
 * and carries no personal data — the server is the only place that can resolve
 * it back to a guest record.
 *
 * - Only the event owner may download cards (spec section 41).
 * - The event must be AUTHORIZED and have an ACTIVE card design assigned.
 * - The PNG is cached on the guest row together with a fingerprint. A request
 *   only re-renders when the design, layout, event title or guest details have
 *   changed; otherwise the cached bytes are served.
 * - `?download=1` returns an attachment with a friendly filename; otherwise
 *   the image is inline so it can be previewed in a dialog.
 */
export async function GET(request: Request, { params }: RouteContext) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id: eventId, guestId } = await params;

    // Ownership + authorization + template in one roundtrip.
    const guest = await prisma.guest.findFirst({
      where: { id: guestId, eventId, event: { ownerId: session.userId } },
      select: {
        id: true,
        fullName: true,
        cardType: true,
        qrToken: true,
        cardStatus: true,
        deliveryStatus: true,
        cardPng: true,
        cardFingerprint: true,
        event: {
          select: {
            title: true,
            status: true,
            updatedAt: true,
            cardTemplate: {
              select: {
                id: true,
                imageUrl: true,
                layout: true,
                updatedAt: true,
                status: true,
              },
            },
          },
        },
      },
    });

    if (!guest) return NextResponse.json({ error: "Guest not found" }, { status: 404 });
    if (guest.event.status !== "AUTHORIZED") {
      return NextResponse.json(
        { error: "This event must be authorized before cards can be generated" },
        { status: 403 },
      );
    }

    const template = guest.event.cardTemplate;
    if (!template || template.status !== "ACTIVE") {
      return NextResponse.json(
        { error: "Choose an active card design for this event before generating cards" },
        { status: 409 },
      );
    }

    // Resolve (and, for designs uploaded before placeholder support, detect
    // and persist) the placeholder layout. The resolved timestamp is what the
    // fingerprint uses, so a lazily-analyzed design invalidates old caches.
    const resolved = await resolveTemplateLayout(template);
    const fingerprint = buildCardFingerprint({
      templateId: template.id,
      templateUpdatedAt: resolved.updatedAt,
      layout: resolved.layout,
      eventUpdatedAt: guest.event.updatedAt,
      guest,
    });

    let png: Buffer;
    if (guest.cardPng && guest.cardFingerprint === fingerprint) {
      png = Buffer.from(guest.cardPng);
      if (guest.cardStatus === "PENDING") {
        await prisma.guest.update({
          where: { id: guest.id },
          data: { cardStatus: "GENERATED" },
        });
      }
    } else {
      const rendered = await renderGuestCard({
        templateDataUrl: template.imageUrl,
        guestName: guest.fullName,
        eventTitle: guest.event.title,
        qrToken: guest.qrToken,
        cardType: guest.cardType,
        layout: resolved.layout,
      });
      png = rendered.png;

      await prisma.guest.update({
        where: { id: guest.id },
        data: {
          cardPng: new Uint8Array(png),
          cardFingerprint: fingerprint,
          // Generation state is monotonic. Delivery state is independent and
          // only the provider-confirmed delivery route may set SENT. A new
          // render means the previously delivered card is no longer current.
          ...(guest.cardStatus === "PENDING" ? { cardStatus: "GENERATED" as const } : {}),
          ...(guest.deliveryStatus !== "NOT_SENT"
            ? {
                deliveryStatus: "NOT_SENT" as const,
                deliveredAt: null,
                deliveryProvider: null,
                deliveryMessageId: null,
                deliveryError: null,
              }
            : {}),
        },
      });
    }

    const download = new URL(request.url).searchParams.get("download") === "1";
    const safeName =
      guest.fullName
        .normalize("NFKD")
        .replace(/[^\w\s-]/g, "")
        .trim()
        .replace(/\s+/g, "-")
        .toLowerCase() || "guest";

    return new NextResponse(new Uint8Array(png), {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Content-Length": String(png.length),
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename="card-${safeName}.png"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    console.error("Card render error:", error);
    return NextResponse.json({ error: "Unable to generate the card" }, { status: 500 });
  }
}
