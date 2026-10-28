import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession, getOwnedEvent } from "@/lib/session";
import { recordAudit, clientIp } from "@/lib/audit";
import { readJsonBody } from "@/lib/request";

type RouteContext = { params: Promise<{ id: string }> };

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/**
 * Save the e-card / invitation configuration for an event.
 * Hard business gate: only AUTHORIZED events may configure cards.
 */
export async function POST(request: Request, { params }: RouteContext) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: eventId } = await params;
    const event = await getOwnedEvent(eventId, session.userId);
    if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });
    if (event.status !== "AUTHORIZED") {
      return NextResponse.json(
        { error: "This event must be authorized before card operations are available" },
        { status: 403 },
      );
    }

    const parsed = await readJsonBody(request, 32 * 1024);
    if (!parsed.ok) return parsed.response;
    const body = parsed.body;

    const theme = typeof body.theme === "string" ? body.theme.trim() : "";
    const accentColor =
      typeof body.accentColor === "string" && HEX_COLOR.test(body.accentColor)
        ? body.accentColor
        : "#2563eb";
    const customMessage =
      typeof body.customMessage === "string" ? body.customMessage.slice(0, 1000) : null;

    const before = await prisma.invitation.findUnique({ where: { eventId } });

    const invitation = await prisma.invitation.upsert({
      where: { eventId },
      update: { templateTheme: theme, accentColor, customMessage },
      create: {
        eventId,
        templateTheme: theme || "classic-blue",
        accentColor,
        customMessage,
      },
    });

    await recordAudit({
      actorId: session.userId,
      action: "card.configured",
      entityType: "invitation",
      entityId: invitation.id,
      metadata: { eventId, before: before ?? null, after: { theme: invitation.templateTheme } },
      ipAddress: clientIp(request),
    });

    return NextResponse.json({ success: true, invitation }, { status: 200 });
  } catch (error) {
    console.error("Error saving e-card configuration:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
