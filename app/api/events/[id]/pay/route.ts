import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession, getOwnedEvent } from "@/lib/session";

type RouteContext = { params: Promise<{ id: string }> };

const PAYMENT_METHODS = ["VodaLipa", "AirtelLipa", "Mpesa"];

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

    const { id: eventId } = await params;
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const paymentReference = String(body.paymentReference || "").trim();
    const paymentMethod = String(body.paymentMethod || "").trim();

    if (!paymentReference) {
      return NextResponse.json({ error: "Payment reference is required" }, { status: 400 });
    }
    if (!PAYMENT_METHODS.includes(paymentMethod)) {
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

    const payment = currentPayment
      ? await prisma.payment.update({
          where: { id: currentPayment.id },
          data: {
            status: "SUBMITTED",
            paymentReference,
            paymentMethod,
            submittedAt: new Date(),
            rejectionReason: null,
          },
        })
      : await prisma.payment.create({
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

    // The admin review queue reads Payment records directly; the latest
    // payment status above is now SUBMITTED.

    return NextResponse.json({ success: true, payment }, { status: 200 });
  } catch (error) {
    console.error("Payment submission error:", error);
    return NextResponse.json({ error: "Unable to submit payment" }, { status: 500 });
  }
}
