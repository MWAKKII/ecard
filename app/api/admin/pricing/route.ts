import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/session";

/**
 * Admin pricing tier management (Step 5).
 * Every method — including reads — requires an ADMIN session.
 * Overlapping guest ranges are rejected, and tiers can be
 * activated/deactivated without deleting them.
 */

function parseRange(body: Record<string, unknown>) {
  const minGuests = Number(body.minGuests);
  const maxGuests = Number(body.maxGuests);
  const price = Number(body.price);
  const valid =
    Number.isInteger(minGuests) &&
    Number.isInteger(maxGuests) &&
    minGuests >= 1 &&
    minGuests <= maxGuests &&
    Number.isFinite(price) &&
    price >= 0;
  return valid ? { minGuests, maxGuests, price } : null;
}

async function findOverlap(minGuests: number, maxGuests: number, excludeId?: string) {
  return prisma.pricingTier.findFirst({
    where: {
      ...(excludeId ? { id: { not: excludeId } } : {}),
      minGuests: { lte: maxGuests },
      maxGuests: { gte: minGuests },
    },
    orderBy: { minGuests: "asc" },
  });
}

export async function GET() {
  try {
    if (!(await requireAdmin())) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const tiers = await prisma.pricingTier.findMany({
      orderBy: { minGuests: "asc" },
    });
    return NextResponse.json(tiers);
  } catch (error) {
    console.error("Pricing fetch error:", error);
    return NextResponse.json({ error: "Failed to fetch pricing tiers" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    if (!(await requireAdmin())) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json();
    const range = parseRange(body);
    if (!range) {
      return NextResponse.json({ error: "Enter a valid guest range and non-negative price" }, { status: 400 });
    }

    const overlap = await findOverlap(range.minGuests, range.maxGuests);
    if (overlap) {
      return NextResponse.json(
        { error: `Range ${range.minGuests}–${range.maxGuests} overlaps the existing tier ${overlap.minGuests}–${overlap.maxGuests}.` },
        { status: 409 },
      );
    }

    const newTier = await prisma.pricingTier.create({
      data: { ...range, active: body.active !== false },
    });

    return NextResponse.json(newTier, { status: 201 });
  } catch (error) {
    console.error("Pricing create error:", error);
    return NextResponse.json({ error: "Failed to create pricing tier" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    if (!(await requireAdmin())) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json();
    if (!body.id || typeof body.id !== "string") {
      return NextResponse.json({ error: "Pricing tier ID is required" }, { status: 400 });
    }

    const range = parseRange(body);
    if (!range) {
      return NextResponse.json({ error: "Enter a valid guest range and non-negative price" }, { status: 400 });
    }

    const overlap = await findOverlap(range.minGuests, range.maxGuests, body.id);
    if (overlap) {
      return NextResponse.json(
        { error: `Range ${range.minGuests}–${range.maxGuests} overlaps the existing tier ${overlap.minGuests}–${overlap.maxGuests}.` },
        { status: 409 },
      );
    }

    // `active` toggles activation without changing the range or price.
    const active = typeof body.active === "boolean" ? body.active : undefined;

    const tier = await prisma.pricingTier.update({
      where: { id: body.id },
      data: { ...range, ...(active !== undefined ? { active } : {}) },
    });
    return NextResponse.json(tier);
  } catch (error) {
    console.error("Pricing update error:", error);
    return NextResponse.json({ error: "Failed to update pricing tier" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    if (!(await requireAdmin())) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const id = new URL(request.url).searchParams.get("id");
    if (!id) return NextResponse.json({ error: "Pricing tier ID is required" }, { status: 400 });

    const [eventCount, paymentCount] = await Promise.all([
      prisma.event.count({ where: { pricingTierId: id } }),
      prisma.payment.count({ where: { pricingTierId: id } }),
    ]);
    if (eventCount > 0 || paymentCount > 0) {
      return NextResponse.json({ error: "This tier cannot be deleted because it is used by an event or payment." }, { status: 409 });
    }

    await prisma.pricingTier.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Pricing delete error:", error);
    return NextResponse.json({ error: "Failed to delete pricing tier" }, { status: 500 });
  }
}
