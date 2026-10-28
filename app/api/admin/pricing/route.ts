import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/session";
import { recordAudit, clientIp } from "@/lib/audit";
import { readJsonBody } from "@/lib/request";

/**
 * Admin pricing tier management (Step 5).
 * Every method - including reads - requires an ADMIN session.
 * Overlapping guest ranges are rejected, and tiers can be
 * activated/deactivated without deleting them.
 */

const MAX_GUESTS = 1_000_000;
const MAX_PRICE = 1_000_000_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseRange(body: Record<string, unknown>) {
  const minGuests = Number(body.minGuests);
  const maxGuests = Number(body.maxGuests);
  const price = Number(body.price);
  const valid =
    Number.isInteger(minGuests) &&
    Number.isInteger(maxGuests) &&
    minGuests >= 1 &&
    minGuests <= maxGuests &&
    maxGuests <= MAX_GUESTS &&
    Number.isFinite(price) &&
    price >= 0 &&
    price <= MAX_PRICE;
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
    const admin = await requireAdmin();
    if (!admin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const parsed = await readJsonBody(request, 32 * 1024);
    if (!parsed.ok) return parsed.response;
    const body = parsed.body;

    const range = parseRange(body);
    if (!range) {
      return NextResponse.json(
        { error: "Enter a valid guest range and non-negative price" },
        { status: 400 },
      );
    }
    if (body.active !== undefined && typeof body.active !== "boolean") {
      return NextResponse.json({ error: "Active must be true or false" }, { status: 400 });
    }

    const overlap = await findOverlap(range.minGuests, range.maxGuests);
    if (overlap) {
      return NextResponse.json(
        {
          error: `Range ${range.minGuests}-${range.maxGuests} overlaps the existing tier ${overlap.minGuests}-${overlap.maxGuests}.`,
        },
        { status: 409 },
      );
    }

    const newTier = await prisma.pricingTier.create({
      data: { ...range, active: body.active === undefined ? true : body.active },
    });

    await recordAudit({
      actorId: admin.userId,
      action: "pricing_tier.created",
      entityType: "pricing_tier",
      entityId: newTier.id,
      metadata: {
        before: null,
        after: {
          minGuests: newTier.minGuests,
          maxGuests: newTier.maxGuests,
          price: newTier.price,
          active: newTier.active,
        },
      },
      ipAddress: clientIp(request),
    });

    return NextResponse.json(newTier, { status: 201 });
  } catch (error) {
    console.error("Pricing create error:", error);
    return NextResponse.json({ error: "Failed to create pricing tier" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const admin = await requireAdmin();
    if (!admin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const parsed = await readJsonBody(request, 32 * 1024);
    if (!parsed.ok) return parsed.response;
    const body = parsed.body;

    if (typeof body.id !== "string" || !UUID_RE.test(body.id)) {
      return NextResponse.json({ error: "Pricing tier not found" }, { status: 404 });
    }

    const range = parseRange(body);
    if (!range) {
      return NextResponse.json(
        { error: "Enter a valid guest range and non-negative price" },
        { status: 400 },
      );
    }
    if (body.active !== undefined && typeof body.active !== "boolean") {
      return NextResponse.json({ error: "Active must be true or false" }, { status: 400 });
    }

    const before = await prisma.pricingTier.findUnique({ where: { id: body.id } });
    if (!before) return NextResponse.json({ error: "Pricing tier not found" }, { status: 404 });

    const overlap = await findOverlap(range.minGuests, range.maxGuests, body.id);
    if (overlap) {
      return NextResponse.json(
        {
          error: `Range ${range.minGuests}-${range.maxGuests} overlaps the existing tier ${overlap.minGuests}-${overlap.maxGuests}.`,
        },
        { status: 409 },
      );
    }

    // `active` toggles activation without changing the range or price.
    const active = typeof body.active === "boolean" ? body.active : undefined;

    const tier = await prisma.pricingTier.update({
      where: { id: body.id },
      data: { ...range, ...(active !== undefined ? { active } : {}) },
    });

    await recordAudit({
      actorId: admin.userId,
      action: "pricing_tier.updated",
      entityType: "pricing_tier",
      entityId: tier.id,
      metadata: {
        before: {
          minGuests: before.minGuests,
          maxGuests: before.maxGuests,
          price: before.price,
          active: before.active,
        },
        after: {
          minGuests: tier.minGuests,
          maxGuests: tier.maxGuests,
          price: tier.price,
          active: tier.active,
        },
      },
      ipAddress: clientIp(request),
    });

    return NextResponse.json(tier);
  } catch (error) {
    console.error("Pricing update error:", error);
    return NextResponse.json({ error: "Failed to update pricing tier" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const admin = await requireAdmin();
    if (!admin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const id = new URL(request.url).searchParams.get("id");
    if (!id || !UUID_RE.test(id)) {
      return NextResponse.json({ error: "Pricing tier not found" }, { status: 404 });
    }

    const before = await prisma.pricingTier.findUnique({ where: { id } });
    if (!before) return NextResponse.json({ error: "Pricing tier not found" }, { status: 404 });

    const [eventCount, paymentCount] = await Promise.all([
      prisma.event.count({ where: { pricingTierId: id } }),
      prisma.payment.count({ where: { pricingTierId: id } }),
    ]);
    if (eventCount > 0 || paymentCount > 0) {
      return NextResponse.json(
        { error: "This tier cannot be deleted because it is used by an event or payment." },
        { status: 409 },
      );
    }

    await prisma.pricingTier.delete({ where: { id } });
    await recordAudit({
      actorId: admin.userId,
      action: "pricing_tier.deleted",
      entityType: "pricing_tier",
      entityId: id,
      metadata: {
        before: {
          minGuests: before.minGuests,
          maxGuests: before.maxGuests,
          price: before.price,
          active: before.active,
        },
        after: null,
      },
      ipAddress: clientIp(request),
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Pricing delete error:", error);
    return NextResponse.json({ error: "Failed to delete pricing tier" }, { status: 500 });
  }
}
