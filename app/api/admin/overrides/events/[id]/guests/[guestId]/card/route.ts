import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/session";
import { generateCardsForGuests } from "@/lib/card-generation";
import { GUEST_PUBLIC_SELECT } from "@/lib/guests";
import { recordAudit, clientIp } from "@/lib/audit";

type RouteContext = { params: Promise<{ id: string; guestId: string }> };

/**
 * Admin card regeneration override.
 *
 * The owner-facing card route only serves AUTHORIZED events. Admins may need to
 * repair/regenerate a card on a suspended event, so this route uses the same
 * renderer with the explicit inactive-event override. A card can only be
 * rendered from an active design.
 */
export async function POST(request: Request, { params }: RouteContext) {
  try {
    const admin = await requireAdmin();
    if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id: eventId, guestId } = await params;
    const guest = await prisma.guest.findFirst({
      where: { id: guestId, eventId },
      select: {
        id: true,
        fullName: true,
        event: {
          select: {
            id: true,
            title: true,
            status: true,
            ownerId: true,
            cardTemplate: { select: { id: true, title: true, status: true } },
          },
        },
      },
    });
    if (!guest) return NextResponse.json({ error: "Guest not found" }, { status: 404 });

    const template = guest.event.cardTemplate;
    if (!template || template.status !== "ACTIVE") {
      return NextResponse.json(
        { error: "Assign an active card design to this event before regenerating a card." },
        { status: 409 },
      );
    }

    const result = await generateCardsForGuests(eventId, [guestId], {
      allowInactiveEvent: true,
    });
    if (result.generated !== 1) {
      return NextResponse.json(
        {
          error:
            result.reason === "no-template"
              ? "Assign an active card design to this event before regenerating a card."
              : "The card could not be rendered. Try again in a moment.",
        },
        { status: 500 },
      );
    }

    const updated = await prisma.guest.findUnique({
      where: { id: guestId },
      select: GUEST_PUBLIC_SELECT,
    });

    await recordAudit({
      actorId: admin.userId,
      action: "guest.card_regenerated",
      entityType: "guest",
      entityId: guestId,
      metadata: {
        eventId,
        eventTitle: guest.event.title,
        ownerId: guest.event.ownerId,
        guestName: guest.fullName,
        templateId: template.id,
        source: "admin_override",
      },
      ipAddress: clientIp(request),
    });

    return NextResponse.json({
      success: true,
      guest: updated,
      card: { generated: result.generated, failed: result.failed, skipped: result.skipped },
    });
  } catch (error) {
    console.error("Admin card regeneration error:", error);
    return NextResponse.json({ error: "Unable to regenerate the card" }, { status: 500 });
  }
}
