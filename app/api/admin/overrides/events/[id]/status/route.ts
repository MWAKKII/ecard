import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/session";
import { recordAudit, clientIp } from "@/lib/audit";
import { readJsonBody } from "@/lib/request";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Admin suspend / reactivate override.
 *
 * Reactivation remains tied to a verified payment, so this is a controlled
 * status correction rather than a way to bypass the payment workflow. Both
 * transitions are audited with before/after state.
 */
export async function PATCH(request: Request, { params }: RouteContext) {
  try {
    const admin = await requireAdmin();
    if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;
    const parsed = await readJsonBody(request, 16 * 1024);
    if (!parsed.ok) return parsed.response;
    const body = parsed.body;

    const target = typeof body.status === "string" ? body.status.toUpperCase() : "";
    if (target !== "AUTHORIZED" && target !== "SUSPENDED") {
      return NextResponse.json(
        { error: "Status must be AUTHORIZED (reactivate) or SUSPENDED." },
        { status: 400 },
      );
    }

    const event = await prisma.event.findUnique({
      where: { id },
      select: { id: true, title: true, ownerId: true, status: true },
    });
    if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });

    if (target === "SUSPENDED" && event.status !== "AUTHORIZED") {
      return NextResponse.json(
        { error: "Only an authorized event can be suspended." },
        { status: 409 },
      );
    }
    if (target === "AUTHORIZED" && event.status !== "SUSPENDED") {
      return NextResponse.json(
        { error: "Only a suspended event can be reactivated here." },
        { status: 409 },
      );
    }

    let verifiedPaymentId: string | null = null;
    if (target === "AUTHORIZED") {
      const verifiedPayment = await prisma.payment.findFirst({
        where: { eventId: id, status: "VERIFIED" },
        select: { id: true },
        orderBy: { createdAt: "desc" },
      });
      if (!verifiedPayment) {
        return NextResponse.json(
          { error: "A verified payment is required before this event can be reactivated." },
          { status: 409 },
        );
      }
      verifiedPaymentId = verifiedPayment.id;
    }

    const updated = await prisma.event.update({
      where: { id },
      data: { status: target },
      select: { id: true, title: true, status: true, updatedAt: true },
    });

    await recordAudit({
      actorId: admin.userId,
      action: target === "AUTHORIZED" ? "event.reactivated" : "event.suspended",
      entityType: "event",
      entityId: id,
      metadata: {
        ownerId: event.ownerId,
        eventTitle: event.title,
        before: { status: event.status },
        after: { status: target },
        ...(verifiedPaymentId ? { verifiedPaymentId } : {}),
        source: "admin_override",
      },
      ipAddress: clientIp(request),
    });

    return NextResponse.json({ success: true, event: updated });
  } catch (error) {
    console.error("Admin event status override error:", error);
    return NextResponse.json({ error: "Unable to change event status" }, { status: 500 });
  }
}
