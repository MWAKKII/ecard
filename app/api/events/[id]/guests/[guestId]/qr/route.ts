import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession, getOwnedEvent } from "@/lib/session";
import { renderQrPng } from "@/lib/qr";

type RouteContext = { params: Promise<{ id: string; guestId: string }> };

/**
 * Render a guest's ticket QR as PNG (Step 9).
 *
 * The image content is a pure function of the stored opaque token — the same
 * token is returned on every request and is never rotated here. Only the
 * event owner may fetch it (spec section 41); the token itself is never
 * returned by any list endpoint.
 */
export async function GET(_request: Request, { params }: RouteContext) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id: eventId, guestId } = await params;
    const event = await getOwnedEvent(eventId, session.userId);
    if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });
    if (event.status !== "AUTHORIZED") {
      return NextResponse.json(
        { error: "This event must be authorized before QR codes are available" },
        { status: 403 },
      );
    }

    const guest = await prisma.guest.findFirst({
      where: { id: guestId, eventId },
      select: { id: true, qrToken: true },
    });
    if (!guest) return NextResponse.json({ error: "Guest not found" }, { status: 404 });

    const png = await renderQrPng(guest.qrToken);

    return new NextResponse(new Uint8Array(png), {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Content-Length": String(png.length),
        "Cache-Control": "private, max-age=86400",
      },
    });
  } catch (error) {
    console.error("QR render error:", error);
    return NextResponse.json({ error: "Unable to render QR code" }, { status: 500 });
  }
}
