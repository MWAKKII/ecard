import { prisma } from "@/lib/prisma";

/**
 * Event/pricing helpers shared by the event API routes (Steps 5–7).
 * Prices are ALWAYS calculated server-side from the database tiers —
 * client-side display is never trusted for the final quote.
 */

export async function findActivePricingTier(guestCount: number) {
  return prisma.pricingTier.findFirst({
    where: {
      active: true,
      minGuests: { lte: guestCount },
      maxGuests: { gte: guestCount },
    },
    orderBy: { minGuests: "asc" },
  });
}

export interface Quote {
  tierId: string;
  tierPrice: number;
  amount: number;
}

/** Returns the server-calculated quote, or null when no active tier covers the count. */
export async function quoteForGuestCount(guestCount: number): Promise<Quote | null> {
  const tier = await findActivePricingTier(guestCount);
  if (!tier) return null;
  return { tierId: tier.id, tierPrice: tier.price, amount: tier.price * guestCount };
}

/** Human-friendly URL slug with a short random suffix to avoid collisions. */
export function buildEventSlug(title: string): string {
  const base =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)+/g, "")
      .slice(0, 60) || "event";
  const suffix = Math.random().toString(36).substring(2, 7);
  return `${base}-${suffix}`;
}

/** Parses the date/time fields of an event form into a single Date, or null. */
export function parseEventStart(date: unknown, time: unknown): Date | null {
  if (typeof date !== "string" || !date.trim()) return null;
  const timePart = typeof time === "string" && time.trim() ? time.trim() : "00:00";
  const combined = `${date.trim()}T${timePart}`;
  const parsed = new Date(combined);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
