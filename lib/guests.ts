import { prisma } from "@/lib/prisma";
import { generateQrToken } from "@/lib/qr";

/**
 * Guest management service (Step 8) with server-side QR token issuance
 * (Step 9). Used by the guest API routes, the CSV import route and the
 * QR test script so validation logic exists in exactly one place.
 *
 * Business gates enforced here:
 * - Only valid, non-duplicate guest rows are accepted.
 * - Every guest receives a cryptographically random qrToken, generated
 *   server-side, once. Tokens are never regenerated implicitly.
 */

export const CARD_TYPES = ["STANDARD", "PREMIUM"] as const;
export type CardTypeName = (typeof CARD_TYPES)[number];

export interface GuestInput {
  fullName?: unknown;
  phone?: unknown;
  whatsapp?: unknown;
  email?: unknown;
  cardType?: unknown;
}

export interface GuestRow {
  fullName: string;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  cardType: CardTypeName;
  qrToken: string;
}

export interface CreateGuestsResult {
  created: number;
  skipped: { row: number; reason: string }[];
  /** Internal-only: used to prepare each new guest's card. Never serialized. */
  guestIds: string[];
}

/**
 * Fields safe to send back to the browser. qrToken stays server-side (the QR
 * image endpoint resolves it), and cardPng/cardFingerprint are server caches.
 */
export const GUEST_PUBLIC_SELECT = {
  id: true,
  fullName: true,
  email: true,
  phone: true,
  whatsapp: true,
  cardType: true,
  cardStatus: true,
  deliveryStatus: true,
  deliveredAt: true,
  deliveryProvider: true,
  deliveryError: true,
  plusOnes: true,
  createdAt: true,
  updatedAt: true,
} as const;

const MAX_NAME_LENGTH = 120;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_PATTERN = /^\+?[0-9][0-9\s\-()]{5,19}$/;

function cleanText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : null;
}

/** Case-insensitive key used for duplicate detection. */
export function normalizeGuestName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

export function cleanPhone(value: unknown): { ok: true; value: string | null } | { ok: false; reason: string } {
  const phone = cleanText(value, 30);
  if (!phone) return { ok: true, value: null };
  if (!PHONE_PATTERN.test(phone)) {
    return { ok: false, reason: `"${phone}" is not a valid phone number.` };
  }
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) {
    return { ok: false, reason: `"${phone}" must have 7–15 digits.` };
  }
  return { ok: true, value: phone };
}

/** Validates and normalizes a single guest row. Does not check duplicates. */
export function validateGuestRow(input: GuestInput): { ok: true; row: GuestRow } | { ok: false; reason: string } {
  const fullName = cleanText(input.fullName, MAX_NAME_LENGTH);
  if (!fullName) return { ok: false, reason: "Guest name is required." };

  const phone = cleanPhone(input.phone);
  if (!phone.ok) return { ok: false, reason: `For "${fullName}": ${phone.reason}` };

  const whatsapp = cleanPhone(input.whatsapp);
  if (!whatsapp.ok) return { ok: false, reason: `For "${fullName}": ${whatsapp.reason}` };

  const email = cleanText(input.email, 254);
  if (email && !EMAIL_PATTERN.test(email)) {
    return { ok: false, reason: `For "${fullName}": "${email}" is not a valid email address.` };
  }

  const cardTypeRaw = cleanText(input.cardType, 20)?.toUpperCase() ?? "STANDARD";
  if (!(CARD_TYPES as readonly string[]).includes(cardTypeRaw)) {
    return { ok: false, reason: `For "${fullName}": card type must be STANDARD or PREMIUM.` };
  }

  return {
    ok: true,
    row: {
      fullName,
      phone: phone.value,
      whatsapp: whatsapp.value,
      email: email ? email.toLowerCase() : null,
      cardType: cardTypeRaw as CardTypeName,
      // Opaque, non-guessable, server-generated (Step 9).
      qrToken: generateQrToken(),
    },
  };
}

/**
 * Validates rows, rejects duplicates (existing guests in the event and
 * duplicates inside the batch) and creates the survivors in one batch.
 * Each new guest gets a fresh QR token — existing guests are untouched.
 */
export async function createGuestsForEvent(
  eventId: string,
  inputs: GuestInput[],
): Promise<CreateGuestsResult> {
  const existing = await prisma.guest.findMany({
    where: { eventId },
    select: { fullName: true, email: true },
  });

  const knownNames = new Set(existing.map((guest) => normalizeGuestName(guest.fullName)));
  const knownEmails = new Set(existing.map((guest) => guest.email).filter(Boolean) as string[]);

  const skipped: { row: number; reason: string }[] = [];
  const rows: GuestRow[] = [];

  inputs.forEach((input, index) => {
    const rowNumber = index + 1;
    const validated = validateGuestRow(input);
    if (!validated.ok) {
      skipped.push({ row: rowNumber, reason: validated.reason });
      return;
    }

    const nameKey = normalizeGuestName(validated.row.fullName);
    if (knownNames.has(nameKey)) {
      skipped.push({ row: rowNumber, reason: `"${validated.row.fullName}" is already on the guest list.` });
      return;
    }
    if (validated.row.email && knownEmails.has(validated.row.email)) {
      skipped.push({ row: rowNumber, reason: `Email "${validated.row.email}" is already on the guest list.` });
      return;
    }

    knownNames.add(nameKey);
    if (validated.row.email) knownEmails.add(validated.row.email);
    rows.push(validated.row);
  });

  const createdRows =
    rows.length > 0
      ? await prisma.guest.createManyAndReturn({
          data: rows.map((row) => ({ eventId, ...row })),
          select: { id: true },
        })
      : [];

  return { created: createdRows.length, skipped, guestIds: createdRows.map((row) => row.id) };
}
