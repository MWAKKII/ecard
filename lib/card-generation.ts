import { createHash } from "node:crypto";
import type { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { renderGuestCard } from "@/lib/card-render";
import {
  analyzeTemplateLayout,
  isUsableTemplateLayout,
  parseTemplateLayout,
  type TemplateLayout,
} from "@/lib/template-layout";

/**
 * Server-side card preparation.
 *
 * New guests get their PNG rendered immediately, using the event's selected
 * design and the template's detected placeholder layout. The PNG is cached on
 * the guest row together with a fingerprint; if the event title, guest details,
 * template image/layout or design assignment changes, the fingerprint changes
 * and the card is re-rendered on the next request.
 */

/**
 * Bump when the rendered output changes without a data change (font handling,
 * placement, QR sizing). Existing cached PNGs then re-render on next request.
 */
const CARD_RENDER_VERSION = 2;

export interface AutoCardResult {
  generated: number;
  failed: number;
  skipped: number;
  reason?: "no-template" | "event-not-ready" | "layout-failed";
}

interface TemplateRecord {
  id: string;
  imageUrl: string;
  layout: unknown;
  updatedAt: Date;
}

export interface ResolvedTemplateLayout {
  layout: TemplateLayout | null;
  updatedAt: Date;
}

/**
 * Return the template's usable placeholder layout, running OCR once if this
 * design has never been analyzed (for templates uploaded before Step 8
 * placeholder support). The empty analysis result is persisted too, so a design
 * without placeholder words is never OCR'd on every render.
 */
export async function resolveTemplateLayout(template: TemplateRecord): Promise<ResolvedTemplateLayout> {
  if (template.layout !== null && template.layout !== undefined) {
    const parsed = parseTemplateLayout(template.layout);
    if (parsed) {
      return {
        layout: isUsableTemplateLayout(parsed) ? parsed : null,
        updatedAt: template.updatedAt,
      };
    }
  }

  try {
    const analyzed = await analyzeTemplateLayout(template.imageUrl);
    const updated = await prisma.cardTemplate.update({
      where: { id: template.id },
      data: { layout: analyzed as unknown as Prisma.InputJsonValue },
      select: { updatedAt: true },
    });
    return {
      layout: isUsableTemplateLayout(analyzed) ? analyzed : null,
      updatedAt: updated.updatedAt,
    };
  } catch (error) {
    console.error(`[cards] template layout analysis failed for ${template.id}:`, error);
    return { layout: null, updatedAt: template.updatedAt };
  }
}

export interface CardFingerprintInput {
  templateId: string;
  templateUpdatedAt: Date;
  layout: TemplateLayout | null;
  eventUpdatedAt: Date;
  guest: {
    fullName: string;
    cardType: string;
    qrToken: string;
  };
}

/** Stable array form — JSONB does not preserve object key order. */
function fingerprintLayout(layout: TemplateLayout | null) {
  if (!layout) return null;
  const text = (slot?: TemplateLayout["placeholders"]["eventTitle"]) =>
    slot
      ? [
          slot.x,
          slot.y,
          slot.width,
          slot.height,
          slot.backgroundTop,
          slot.backgroundBottom,
          slot.color,
          slot.fontSize,
          slot.fontWeight,
        ]
      : null;
  const qr = layout.placeholders.qr;
  return {
    version: layout.version,
    width: layout.width,
    height: layout.height,
    eventTitle: text(layout.placeholders.eventTitle),
    guestName: text(layout.placeholders.guestName),
    quality: text(layout.placeholders.quality),
    qr: qr
      ? [
          qr.x,
          qr.y,
          qr.width,
          qr.height,
          qr.text.x,
          qr.text.y,
          qr.text.width,
          qr.text.height,
          qr.background,
          qr.drawBackground,
        ]
      : null,
  };
}

export function buildCardFingerprint(input: CardFingerprintInput): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        renderVersion: CARD_RENDER_VERSION,
        templateId: input.templateId,
        templateUpdatedAt: input.templateUpdatedAt.toISOString(),
        layout: fingerprintLayout(input.layout),
        eventUpdatedAt: input.eventUpdatedAt.toISOString(),
        guest: {
          fullName: input.guest.fullName,
          cardType: input.guest.cardType,
          qrToken: input.guest.qrToken,
        },
      }),
    )
    .digest("hex");
}

/**
 * Render and cache cards for one or more guests of an event. Failures are
 * isolated per guest (the guest stays PENDING and can be retried by opening the
 * card); a bulk import never fails just because one image could not render.
 */
export async function generateCardsForGuests(
  eventId: string,
  guestIds: string[],
): Promise<AutoCardResult> {
  if (guestIds.length === 0) return { generated: 0, failed: 0, skipped: 0 };

  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: {
      id: true,
      title: true,
      updatedAt: true,
      status: true,
      cardTemplate: {
        select: {
          id: true,
          imageUrl: true,
          layout: true,
          updatedAt: true,
          status: true,
        },
      },
    },
  });

  if (!event || event.status !== "AUTHORIZED") {
    return { generated: 0, failed: 0, skipped: guestIds.length, reason: "event-not-ready" };
  }

  const template = event.cardTemplate;
  if (!template || template.status !== "ACTIVE") {
    return { generated: 0, failed: 0, skipped: guestIds.length, reason: "no-template" };
  }

  let resolved: ResolvedTemplateLayout;
  try {
    resolved = await resolveTemplateLayout(template);
  } catch (error) {
    console.error(`[cards] could not resolve template layout for event ${eventId}:`, error);
    return { generated: 0, failed: 0, skipped: guestIds.length, reason: "layout-failed" };
  }

  const guests = await prisma.guest.findMany({
    where: { id: { in: guestIds }, eventId },
    select: {
      id: true,
      fullName: true,
      cardType: true,
      cardStatus: true,
      deliveryStatus: true,
      cardFingerprint: true,
      qrToken: true,
    },
  });

  const queue = [...guests];
  let generated = 0;
  let failed = 0;

  const renderOne = async (guest: (typeof guests)[number]) => {
    try {
      const { png } = await renderGuestCard({
        templateDataUrl: template.imageUrl,
        guestName: guest.fullName,
        eventTitle: event.title,
        qrToken: guest.qrToken,
        cardType: guest.cardType,
        layout: resolved.layout,
      });

      const fingerprint = buildCardFingerprint({
        templateId: template.id,
        templateUpdatedAt: resolved.updatedAt,
        layout: resolved.layout,
        eventUpdatedAt: event.updatedAt,
        guest,
      });
      // A delivered card is only current while its fingerprint matches. If the
      // design/title/guest data changed, the newly rendered card has not been
      // sent yet, so reset delivery instead of falsely keeping SENT.
      const resetDelivery =
        guest.cardFingerprint !== fingerprint && guest.deliveryStatus !== "NOT_SENT";

      await prisma.guest.update({
        where: { id: guest.id },
        data: {
          cardPng: new Uint8Array(png),
          cardFingerprint: fingerprint,
          ...(guest.cardStatus === "PENDING" ? { cardStatus: "GENERATED" as const } : {}),
          ...(resetDelivery
            ? {
                deliveryStatus: "NOT_SENT" as const,
                deliveredAt: null,
                deliveryProvider: null,
                deliveryMessageId: null,
                deliveryError: null,
              }
            : {}),
        },
      });
      return true;
    } catch (error) {
      console.error(`[cards] generation failed for guest ${guest.id}:`, error);
      return false;
    }
  };

  const workerCount = Math.min(4, queue.length);
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (queue.length > 0) {
        const guest = queue.shift()!;
        if (await renderOne(guest)) generated += 1;
        else failed += 1;
      }
    }),
  );

  return {
    generated,
    failed,
    skipped: Math.max(0, guestIds.length - guests.length),
  };
}
