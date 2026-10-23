import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { renderGuestCard } from "@/lib/card-render";

type RouteContext = { params: Promise<{ id: string; guestId: string }> };

/**
 * Personalized e-card PNG for one guest (spec Step 8).
 *
 * Composition: event's card template + guest name + the guest's opaque QR
 * token. The token is random and carries no personal data — the server is the
 * only place that can resolve it back to a guest record.
 *
 * - Only the event owner may download cards (spec section 41).
 * - The event must be AUTHORIZED and have an ACTIVE card design assigned.
 * - Rendering marks a PENDING card as GENERATED (idempotent).
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
        qrToken: true,
        cardStatus: true,
        event: {
          select: {
            title: true,
            status: true,
            cardTemplate: { select: { imageUrl: true, status: true } },
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

    const { png } = await renderGuestCard({
      templateDataUrl: template.imageUrl,
      guestName: guest.fullName,
      eventTitle: guest.event.title,
      qrToken: guest.qrToken,
    });

    if (guest.cardStatus === "PENDING") {
      await prisma.guest.update({
        where: { id: guest.id },
        data: { cardStatus: "GENERATED" },
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
        "Cache-Control": "private, max-age=60",
      },
    });
  } catch (error) {
    console.error("Card render error:", error);
    return NextResponse.json({ error: "Unable to generate the card" }, { status: 500 });
  }
}
