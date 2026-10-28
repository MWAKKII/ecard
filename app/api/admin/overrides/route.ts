import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/session";

/**
 * Admin override overview.
 *
 * This is deliberately a separate admin-only surface from the organizer
 * routes: a normal client can never list another client's account or events
 * through it. Every write performed from this surface is audited.
 */
export async function GET() {
  try {
    const admin = await requireAdmin();
    if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const [clients, events] = await Promise.all([
      prisma.user.findMany({
        select: {
          id: true,
          name: true,
          email: true,
          username: true,
          phone: true,
          role: true,
          authorizationStatus: true,
          createdAt: true,
          _count: { select: { events: true } },
        },
        orderBy: { createdAt: "desc" },
      }),
      prisma.event.findMany({
        select: {
          id: true,
          title: true,
          type: true,
          status: true,
          location: true,
          startsAt: true,
          endsAt: true,
          guestCount: true,
          createdAt: true,
          owner: { select: { id: true, name: true, email: true } },
          _count: { select: { guests: true } },
        },
        orderBy: { startsAt: "desc" },
      }),
    ]);

    return NextResponse.json({ clients, events });
  } catch (error) {
    console.error("Admin override overview error:", error);
    return NextResponse.json({ error: "Unable to load override data" }, { status: 500 });
  }
}
