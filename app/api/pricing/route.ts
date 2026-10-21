import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * Public pricing read endpoint (spec section 39 — public "Pricing" page,
 * event creation quote preview). Returns active tiers only; the final price
 * is always recalculated server-side when the event is created (Step 5).
 */
export async function GET() {
  try {
    const tiers = await prisma.pricingTier.findMany({
      where: { active: true },
      orderBy: { minGuests: "asc" },
    });
    return NextResponse.json(tiers);
  } catch (error) {
    console.error("Public pricing fetch error:", error);
    return NextResponse.json({ error: "Failed to fetch pricing tiers" }, { status: 500 });
  }
}
