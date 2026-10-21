import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession, getOwnedEvent } from "@/lib/session";
import { createGuestsForEvent, GuestInput } from "@/lib/guests";
import { recordAudit, clientIp } from "@/lib/audit";

type RouteContext = { params: Promise<{ id: string }> };

const MAX_ROWS = 2000;

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
      let body: Record<string, unknown>;
      try {
        body = await request.json();
      } catch {
        return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
      }
      const list = Array.isArray(body.guests) ? body.guests : null;
      if (!list) return NextResponse.json({ error: "A `guests` array is required." }, { status: 400 });
      rawRowCount = list.length;
      rows = list.slice(0, MAX_ROWS) as GuestInput[];
    } else {
      const text = await request.text();
      if (!text.trim()) return NextResponse.json({ error: "CSV file is empty." }, { status: 400 });
      const parsed = parseCsv(text);
      if (parsed.error) return NextResponse.json({ error: parsed.error }, { status: 400 });
      rawRowCount = parsed.rows.length;
      rows = parsed.rows.slice(0, MAX_ROWS);
    }

    if (rows.length === 0) {
      return NextResponse.json({ error: "No guest rows found in the upload." }, { status: 400 });
    }

    // Pricing-tier capacity governs the list size (e.g. the 1-100 tier tops
    // out at 100 guests) — a CSV import may never push past the tier limit.
    const [existingCount, tier] = await Promise.all([
      prisma.guest.count({ where: { eventId } }),
      prisma.pricingTier.findUnique({ where: { id: event.pricingTierId } }),
    ]);
    const capacity = tier?.maxGuests ?? event.guestCount;
    if (existingCount + rows.length > capacity) {
      const remaining = Math.max(0, capacity - existingCount);
      const plan = tier ? `The ${tier.minGuests}-${tier.maxGuests} guest tier` : "This pricing plan";
      return NextResponse.json(
        {
          error:
            `${plan} allows up to ${capacity} guest(s); ${existingCount} already on the list ` +
            `(${remaining} slot${remaining === 1 ? "" : "s"} left). Import ${remaining} or fewer rows, ` +
            `or choose a larger tier.`,
        },
        { status: 409 },
      );
    }

    const result = await createGuestsForEvent(eventId, rows);

    await recordAudit({
      actorId: session.userId,
      action: "guests.imported",
      entityType: "event",
      entityId: eventId,
      metadata: { rawRows: rawRowCount, created: result.created, skipped: result.skipped.length },
      ipAddress: clientIp(request),
    });

    return NextResponse.json(result, { status: 201 });
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
