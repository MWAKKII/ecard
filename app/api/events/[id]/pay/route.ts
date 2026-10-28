import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession, getOwnedEvent } from "@/lib/session";
import { readJsonBody } from "@/lib/request";
import { takeRateLimit, rateLimitResponse } from "@/lib/rate-limit";

type RouteContext = { params: Promise<{ id: string }> };

const PAYMENT_METHODS = ["VodaLipa", "AirtelLipa", "Mpesa"];
const MAX_REFERENCE_LENGTH = 120;
const MAX_BODY_BYTES = 32 * 1024;

/**
 * Submit (or resubmit) a manual mobile-money payment proof for an event.
 * Only the event owner may submit; already-authorized events are closed.
 */
export async function POST(request: Request, { params }: RouteContext) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const limit = takeRateLimit(`payment:submit:${session.userId}`, 30, 60 * 60 * 1000);
    if (!limit.allowed) {
      return rateLimitResponse(limit, "Too many payment submissions. Try again later.");
    }

    const { id: eventId } = await params;
    const parsed = await readJsonBody(request, MAX_BODY_BYTES);
    if (!parsed.ok) return parsed.response;
    const body = parsed.body;

    const paymentReference =
      typeof body.paymentReference === "string" ? body.paymentReference.trim() : "";
    const paymentMethod =
      typeof body.paymentMethod === "string" ? body.paymentMethod.trim() : "";

    if (!paymentReference || paymentReference.length > MAX_REFERENCE_LENGTH) {
      return NextResponse.json({ error: "Payment reference is required" }, { status: 400 });
    }
    if (paymentMethod.length > 30 || !PAYMENT_METHODS.includes(paymentMethod)) {
      return NextResponse.json({ error: "Select a valid payment method" }, { status: 400 });
    }

    const event = await getOwnedEvent(eventId, session.userId);
    if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });
    if (event.status === "AUTHORIZED") {
      return NextResponse.json({ error: "This event is already authorized" }, { status: 409 });
    }

    const currentPayment = await prisma.payment.findFirst({
      where: { eventId },
      orderBy: { createdAt: "desc" },
    });
    if (currentPayment?.status === "VERIFIED") {
      return NextResponse.json({ error: "Payment has already been verified" }, { status: 409 });
    }

    let payment;
    if (currentPayment) {
      // Compare-and-set prevents a concurrent admin verification/rejection
      // from being overwritten by a late client submission.
      const updated = await prisma.payment.updateMany({
        where: {
          id: currentPayment.id,
          status: { in: ["PENDING", "SUBMITTED", "REJECTED"] },
        },
        data: {
          status: "SUBMITTED",
          paymentReference,
          paymentMethod,
          submittedAt: new Date(),
          rejectionReason: null,
        },
      });
      if (updated.count !== 1) {
        return NextResponse.json(
          { error: "This payment has already been reviewed. Refresh the page." },
          { status: 409 },
        );
      }
      payment = await prisma.payment.findUnique({ where: { id: currentPayment.id } });
    } else {
      payment = await prisma.payment.create({
        data: {
          eventId,
          userId: session.userId,
          pricingTierId: event.pricingTierId,
          amount: event.quotedAmount,
          currency: "TSH",
          paymentReference,
          paymentMethod,
          submittedAt: new Date(),
          status: "SUBMITTED",
        },
      });
    }

    return NextResponse.json({ success: true, payment }, { status: 200 });
  } catch (error) {
    console.error("Payment submission error:", error);
    return NextResponse.json({ error: "Unable to submit payment" }, { status: 500 });
  }
}
