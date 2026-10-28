import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/session";
import { recordAudit, clientIp } from "@/lib/audit";
import { readJsonBody } from "@/lib/request";

/**
 * Admin payment review & event authorization (Step 7).
 * All methods require an ADMIN session.
 * Every verify/reject/authorize/suspend decision is written to AuditLog.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_REJECTION_REASON_LENGTH = 500;

export async function GET() {
  try {
    if (!(await requireAdmin())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const payments = await prisma.payment.findMany({
      include: {
        user: { select: { name: true, email: true } },
        event: { select: { id: true, title: true, status: true, quotedAmount: true } },
        reviewedBy: { select: { name: true, email: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json(payments);
  } catch (error) {
    console.error("Admin payments fetch error:", error);
    return NextResponse.json({ error: "Unable to load payments" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const admin = await requireAdmin();
    if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const ip = clientIp(request);

    const parsed = await readJsonBody(request, 32 * 1024);
    if (!parsed.ok) return parsed.response;
    const body = parsed.body;

    const paymentId = typeof body.paymentId === "string" ? body.paymentId : "";
    const status = typeof body.status === "string" ? body.status : undefined;
    const eventAction = typeof body.eventAction === "string" ? body.eventAction : "";
    const rejectionReason =
      typeof body.rejectionReason === "string" ? body.rejectionReason.trim() : "";

    if (rejectionReason.length > MAX_REJECTION_REASON_LENGTH) {
      return NextResponse.json(
        { error: `Rejection reason must be ${MAX_REJECTION_REASON_LENGTH} characters or fewer` },
        { status: 400 },
      );
    }

    if (status !== undefined) {
      if (status !== "VERIFIED" && status !== "REJECTED") {
        return NextResponse.json(
          { error: "A payment ID and VERIFIED or REJECTED status are required" },
          { status: 400 },
        );
      }
      if (!paymentId || !UUID_RE.test(paymentId)) {
        return NextResponse.json({ error: "Payment not found" }, { status: 404 });
      }
      const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
      if (!payment) return NextResponse.json({ error: "Payment not found" }, { status: 404 });
      if (payment.status !== "SUBMITTED") {
        return NextResponse.json(
          { error: "Only submitted payments can be reviewed" },
          { status: 409 },
        );
      }
      if (status === "REJECTED" && !rejectionReason) {
        return NextResponse.json({ error: "A rejection reason is required" }, { status: 400 });
      }

      // Compare-and-set: two admins reviewing at the same time cannot
      // overwrite each other's decision.
      const reviewed = await prisma.payment.updateMany({
        where: { id: paymentId, status: "SUBMITTED" },
        data: {
          status,
          reviewedAt: new Date(),
          reviewedById: admin.userId,
          rejectionReason: status === "REJECTED" ? rejectionReason : null,
        },
      });
      if (reviewed.count !== 1) {
        return NextResponse.json(
          { error: "This payment was already reviewed. Refresh the page." },
          { status: 409 },
        );
      }

      const updatedPayment = await prisma.payment.findUnique({ where: { id: paymentId } });
      await recordAudit({
        actorId: admin.userId,
        action: status === "VERIFIED" ? "payment.verified" : "payment.rejected",
        entityType: "payment",
        entityId: paymentId,
        metadata: {
          eventId: payment.eventId,
          before: { status: payment.status },
          after: { status },
          ...(status === "REJECTED" ? { rejectionReason } : {}),
        },
        ipAddress: ip,
      });
      return NextResponse.json({ success: true, payment: updatedPayment });
    }

    if (!paymentId || !UUID_RE.test(paymentId) || !["AUTHORIZED", "SUSPENDED"].includes(eventAction)) {
      return NextResponse.json(
        { error: "A payment ID and AUTHORIZED or SUSPENDED action are required" },
        { status: 400 },
      );
    }
    const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
    if (!payment?.eventId) {
      return NextResponse.json({ error: "Payment is not linked to an event" }, { status: 400 });
    }
    if (eventAction === "AUTHORIZED" && payment.status !== "VERIFIED") {
      return NextResponse.json(
        { error: "Only verified payments can authorize an event" },
        { status: 409 },
      );
    }
    const beforeEvent = await prisma.event.findUnique({
      where: { id: payment.eventId },
      select: { status: true },
    });
    const event = await prisma.event.update({
      where: { id: payment.eventId },
      data: { status: eventAction as "AUTHORIZED" | "SUSPENDED" },
    });
    await recordAudit({
      actorId: admin.userId,
      action: eventAction === "AUTHORIZED" ? "event.authorized" : "event.suspended",
      entityType: "event",
      entityId: payment.eventId,
      metadata: {
        paymentId,
        before: { status: beforeEvent?.status },
        after: { status: eventAction },
      },
      ipAddress: ip,
    });
    return NextResponse.json({ success: true, event });
  } catch (error) {
    console.error("Admin payment action error:", error);
    return NextResponse.json({ error: "Unable to update payment or event" }, { status: 500 });
  }
}
