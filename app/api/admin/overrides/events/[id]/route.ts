import { NextResponse } from "next/server";
import type { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/session";
import { recordAudit, clientIp } from "@/lib/audit";
import { readJsonBody } from "@/lib/request";

type RouteContext = { params: Promise<{ id: string }> };

const EVENT_TYPES = ["WEDDING", "CORPORATE", "OTHER"] as const;
const MAX_TITLE_LENGTH = 200;
const MAX_TEXT_LENGTH = 2000;

const INVALID_DATE = Symbol("invalid-date");

function parseDateField(value: unknown): Date | null | typeof INVALID_DATE {
  if (value === null || value === "") return null;
  if (typeof value !== "string") return INVALID_DATE;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? INVALID_DATE : parsed;
}

/**
 * Admin event detail and correction.
 *
 * Organizers can only reach their own events through /api/events/[id]; this
 * route deliberately bypasses ownership for admins while still requiring an
 * ADMIN session. Every successful change writes an AuditLog row.
 */
export async function GET(_request: Request, { params }: RouteContext) {
  try {
    const admin = await requireAdmin();
    if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;
    const [event, availableTemplates] = await Promise.all([
      prisma.event.findUnique({
        where: { id },
        select: {
          id: true,
          title: true,
          type: true,
          coupleNames: true,
          description: true,
          location: true,
          startsAt: true,
          endsAt: true,
          status: true,
          guestCount: true,
          quotedAmount: true,
          createdAt: true,
          updatedAt: true,
          owner: {
            select: {
              id: true,
              name: true,
              email: true,
              username: true,
              phone: true,
              authorizationStatus: true,
            },
          },
          pricingTier: {
            select: { id: true, minGuests: true, maxGuests: true, price: true },
          },
          cardTemplate: { select: { id: true, title: true, status: true } },
          payments: {
            select: {
              id: true,
              status: true,
              amount: true,
              currency: true,
              createdAt: true,
              rejectionReason: true,
            },
            orderBy: { createdAt: "desc" },
            take: 5,
          },
          guests: {
            select: {
              id: true,
              fullName: true,
              email: true,
              phone: true,
              whatsapp: true,
              cardType: true,
              cardStatus: true,
              deliveryStatus: true,
              deliveredAt: true,
              plusOnes: true,
              createdAt: true,
              attendances: {
                take: 1,
                select: {
                  id: true,
                  status: true,
                  checkedInAt: true,
                  notes: true,
                  checkedInById: true,
                  updatedAt: true,
                },
              },
            },
            orderBy: { fullName: "asc" },
          },
        },
      }),
      prisma.cardTemplate.findMany({
        where: { status: "ACTIVE" },
        select: { id: true, title: true },
        orderBy: { createdAt: "desc" },
      }),
    ]);

    if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });

    return NextResponse.json({ ...event, availableTemplates });
  } catch (error) {
    console.error("Admin event override detail error:", error);
    return NextResponse.json({ error: "Unable to load event" }, { status: 500 });
  }
}

export async function PATCH(request: Request, { params }: RouteContext) {
  try {
    const admin = await requireAdmin();
    if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;
    const event = await prisma.event.findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        type: true,
        coupleNames: true,
        description: true,
        location: true,
        startsAt: true,
        endsAt: true,
        cardTemplateId: true,
        ownerId: true,
        status: true,
      },
    });
    if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });

    const parsed = await readJsonBody(request, 64 * 1024);
    if (!parsed.ok) return parsed.response;
    const body = parsed.body;

    const updates: Prisma.EventUncheckedUpdateInput = {};
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};

    if (body.title !== undefined) {
      if (typeof body.title !== "string") {
        return NextResponse.json({ error: "Event title must be text." }, { status: 400 });
      }
      const title = body.title.trim();
      if (!title || title.length > MAX_TITLE_LENGTH) {
        return NextResponse.json(
          { error: `Event title is required (max ${MAX_TITLE_LENGTH} characters).` },
          { status: 400 },
        );
      }
      if (title !== event.title) {
        before.title = event.title;
        after.title = title;
        updates.title = title;
      }
    }

    if (body.type !== undefined) {
      if (typeof body.type !== "string") {
        return NextResponse.json({ error: "Invalid event type" }, { status: 400 });
      }
      const type = body.type.toUpperCase();
      if (!(EVENT_TYPES as readonly string[]).includes(type)) {
        return NextResponse.json({ error: "Invalid event type" }, { status: 400 });
      }
      if (type !== event.type) {
        before.type = event.type;
        after.type = type;
        updates.type = type as (typeof EVENT_TYPES)[number];
      }
    }

    for (const field of ["coupleNames", "description", "location"] as const) {
      if (body[field] === undefined) continue;
      if (body[field] !== null && typeof body[field] !== "string") {
        return NextResponse.json({ error: `${field} must be text.` }, { status: 400 });
      }
      const value = typeof body[field] === "string" ? (body[field] as string).trim() : "";
      if (value.length > MAX_TEXT_LENGTH) {
        return NextResponse.json(
          { error: `${field} must be ${MAX_TEXT_LENGTH} characters or fewer.` },
          { status: 400 },
        );
      }
      const normalized = value || null;
      if (normalized !== event[field]) {
        before[field] = event[field];
        after[field] = normalized;
        updates[field] = normalized;
      }
    }

    if (body.startsAt !== undefined) {
      const startsAt = parseDateField(body.startsAt);
      if (startsAt === INVALID_DATE || startsAt === null) {
        return NextResponse.json({ error: "A valid event start date and time are required." }, { status: 400 });
      }
      if (startsAt.getTime() !== event.startsAt.getTime()) {
        before.startsAt = event.startsAt.toISOString();
        after.startsAt = startsAt.toISOString();
        updates.startsAt = startsAt;
      }
    }

    if (body.endsAt !== undefined) {
      const endsAt = parseDateField(body.endsAt);
      if (endsAt === INVALID_DATE) {
        return NextResponse.json({ error: "The event end date and time is invalid." }, { status: 400 });
      }
      const previous = event.endsAt?.getTime() ?? null;
      const next = endsAt?.getTime() ?? null;
      if (next !== previous) {
        before.endsAt = event.endsAt?.toISOString() ?? null;
        after.endsAt = endsAt?.toISOString() ?? null;
        updates.endsAt = endsAt;
      }
    }

    if (body.cardTemplateId !== undefined) {
      let cardTemplateId: string | null = null;
      if (body.cardTemplateId !== null && body.cardTemplateId !== "") {
        if (typeof body.cardTemplateId !== "string") {
          return NextResponse.json({ error: "Invalid card design" }, { status: 400 });
        }
        const design = await prisma.cardTemplate.findFirst({
          where: { id: body.cardTemplateId, status: "ACTIVE" },
          select: { id: true },
        });
        if (!design) {
          return NextResponse.json(
            { error: "That card design is not active. Pick an active design." },
            { status: 400 },
          );
        }
        cardTemplateId = design.id;
      }
      if (cardTemplateId !== event.cardTemplateId) {
        before.cardTemplateId = event.cardTemplateId;
        after.cardTemplateId = cardTemplateId;
        updates.cardTemplateId = cardTemplateId;
      }
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }

    const effectiveStart = (updates.startsAt as Date | undefined) ?? event.startsAt;
    const effectiveEnd =
      updates.endsAt !== undefined ? (updates.endsAt as Date | null) : event.endsAt;
    if (effectiveEnd && effectiveEnd.getTime() <= effectiveStart.getTime()) {
      return NextResponse.json(
        { error: "The event end date must be after the start date." },
        { status: 400 },
      );
    }

    const updated = await prisma.event.update({
      where: { id },
      data: updates,
      select: {
        id: true,
        title: true,
        type: true,
        coupleNames: true,
        description: true,
        location: true,
        startsAt: true,
        endsAt: true,
        status: true,
        cardTemplateId: true,
        updatedAt: true,
      },
    });

    await recordAudit({
      actorId: admin.userId,
      action: "event.admin_updated",
      entityType: "event",
      entityId: id,
      metadata: {
        ownerId: event.ownerId,
        eventTitle: event.title,
        before,
        after,
        source: "admin_override",
      },
      ipAddress: clientIp(request),
    });

    return NextResponse.json({ success: true, event: updated });
  } catch (error) {
    console.error("Admin event override update error:", error);
    return NextResponse.json({ error: "Unable to update event" }, { status: 500 });
  }
}
