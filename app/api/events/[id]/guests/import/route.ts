import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession, getOwnedEvent } from "@/lib/session";
import { createGuestsForEvent, GuestInput, lockEventForGuestWrite } from "@/lib/guests";
import { generateCardsForGuests } from "@/lib/card-generation";
import { recordAudit, clientIp } from "@/lib/audit";
import { readJsonBody, readTextBody } from "@/lib/request";
import { takeRateLimit, rateLimitResponse } from "@/lib/rate-limit";

type RouteContext = { params: Promise<{ id: string }> };

// Batch card preparation can take longer than a default function timeout.
export const maxDuration = 60;

const MAX_ROWS = 2000;
const MAX_BODY_BYTES = 5 * 1024 * 1024;

/**
 * CSV bulk import (Step 8).
 * Expected header: fullName,phone,whatsapp,email,cardType
 * (extra columns are ignored; "name" is accepted as an alias for fullName.)
 */
export async function POST(request: Request, { params }: RouteContext) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id: eventId } = await params;
    const event = await getOwnedEvent(eventId, session.userId);
    if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });

    const limit = takeRateLimit(`guests:import:${session.userId}`, 10, 60 * 1000);
    if (!limit.allowed) {
      return rateLimitResponse(limit, "Too many guest imports. Try again later.");
    }
    if (event.status !== "AUTHORIZED") {
      return NextResponse.json(
        { error: "This event must be authorized before guests can be managed" },
        { status: 403 },
      );
    }

    const contentType = request.headers.get("content-type") || "";
    let rows: GuestInput[] = [];
    let rawRowCount = 0;

    if (contentType.includes("application/json")) {
      const parsedBody = await readJsonBody(request, MAX_BODY_BYTES);
      if (!parsedBody.ok) return parsedBody.response;
      const list = Array.isArray(parsedBody.body.guests) ? parsedBody.body.guests : null;
      if (!list) {
        return NextResponse.json({ error: "A `guests` array is required." }, { status: 400 });
      }
      rawRowCount = list.length;
      rows = list.slice(0, MAX_ROWS) as GuestInput[];
    } else {
      const parsedBody = await readTextBody(request, MAX_BODY_BYTES);
      if (!parsedBody.ok) return parsedBody.response;
      if (!parsedBody.text.trim()) {
        return NextResponse.json({ error: "CSV file is empty." }, { status: 400 });
      }
      const parsed = parseCsv(parsedBody.text);
      if (parsed.error) return NextResponse.json({ error: parsed.error }, { status: 400 });
      rawRowCount = parsed.rows.length;
      rows = parsed.rows.slice(0, MAX_ROWS);
    }

    if (rows.length === 0) {
      return NextResponse.json({ error: "No guest rows found in the upload." }, { status: 400 });
    }

    // Pricing-tier capacity governs the list size (e.g. the 1-100 tier tops
    // out at 100 guests) — a CSV import may never push past the tier limit.
    const outcome = await prisma.$transaction(async (tx) => {
      await lockEventForGuestWrite(tx, eventId);

      const [existingCount, tier] = await Promise.all([
        tx.guest.count({ where: { eventId } }),
        tx.pricingTier.findUnique({ where: { id: event.pricingTierId } }),
      ]);
      const capacity = tier?.maxGuests ?? event.guestCount;
      if (existingCount + rows.length > capacity) {
        const remaining = Math.max(0, capacity - existingCount);
        const plan = tier
          ? `The ${tier.minGuests}-${tier.maxGuests} guest tier`
          : "This pricing plan";
        return {
          ok: false as const,
          status: 409,
          error:
            `${plan} allows up to ${capacity} guest(s); ${existingCount} already on the list ` +
            `(${remaining} slot${remaining === 1 ? "" : "s"} left). Import ${remaining} or fewer rows, ` +
            `or choose a larger tier.`,
        };
      }

      const result = await createGuestsForEvent(eventId, rows, tx);
      return { ok: true as const, result };
    });

    if (!outcome.ok) {
      return NextResponse.json({ error: outcome.error }, { status: outcome.status });
    }
    const result = outcome.result;

    // Prepare a card for every newly imported guest, using the event's
    // selected design. Individual render failures leave that guest PENDING
    // without failing the import.
    const cards = await generateCardsForGuests(eventId, result.guestIds);

    await recordAudit({
      actorId: session.userId,
      action: "guests.imported",
      entityType: "event",
      entityId: eventId,
      metadata: {
        rawRows: rawRowCount,
        created: result.created,
        skipped: result.skipped.length,
        cardsGenerated: cards.generated,
      },
      ipAddress: clientIp(request),
    });

    return NextResponse.json(
      { created: result.created, skipped: result.skipped, cardsGenerated: cards.generated },
      { status: 201 },
    );
  } catch (error) {
    console.error("Guest import error:", error);
    return NextResponse.json({ error: "Unable to import guests" }, { status: 500 });
  }
}

/** Minimal RFC-4180-ish CSV parser (quotes, embedded commas/newlines). */
function parseCsv(text: string): { rows: GuestInput[]; error?: string } {
  const clean = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (inQuotes) {
      if (ch === '"') {
        if (clean[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      record.push(field);
      field = "";
    } else if (ch === "\n") {
      record.push(field);
      records.push(record);
      record = [];
      field = "";
    } else {
      field += ch;
    }
  }
  if (inQuotes) return { rows: [], error: "CSV has an unterminated quoted value." };
  if (field.length > 0 || record.length > 0) {
    record.push(field);
    records.push(record);
  }

  const nonEmpty = records.filter((r) => r.some((c) => c.trim()));
  if (nonEmpty.length < 2) return { rows: [], error: "CSV needs a header row and at least one guest row." };

  const header = nonEmpty[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, ""));
  const idx = (names: string[]) => header.findIndex((h) => names.includes(h));

  const iName = idx(["fullname", "name", "guestname"]);
  if (iName === -1) {
    return { rows: [], error: 'CSV must have a "fullName" (or "name") column.' };
  }
  const iPhone = idx(["phone", "phonenumber", "mobile"]);
  const iWhats = idx(["whatsapp", "whatsappl"]);
  const iEmail = idx(["email", "emailaddress"]);
  const iCard = idx(["cardtype", "type"]);

  const rows: GuestInput[] = nonEmpty.slice(1).map((cols) => ({
    fullName: cols[iName] ?? "",
    phone: iPhone >= 0 ? cols[iPhone] : "",
    whatsapp: iWhats >= 0 ? cols[iWhats] : "",
    email: iEmail >= 0 ? cols[iEmail] : "",
    cardType: iCard >= 0 ? cols[iCard] : "STANDARD",
  }));

  return { rows };
}
