import sharp from "sharp";
import { renderQrPng } from "@/lib/qr";

/**
 * Personalized e-card renderer (spec: CARD TEMPLATE + Guest Name + QR → PNG).
 *
 * The administrator supplies the template image; this module composites the
 * guest's name, the event title and the guest's opaque QR token over it and
 * always returns a PNG — the format that is convenient to send on WhatsApp.
 *
 * Layout rules are template-agnostic: a dark gradient is drawn across the
 * bottom of the image so white text stays readable on any design, and the QR
 * sits in a white rounded square so it remains scannable.
 */

/** data:image/<type>;base64,<payload> */
const DATA_URL_RE = /^data:image\/(png|jpeg|webp|gif|avif);base64,([A-Za-z0-9+/]+={0,2})$/;

export class InvalidTemplateError extends Error {
  constructor(message = "The card template is not a valid image") {
    super(message);
    this.name = "InvalidTemplateError";
  }
}

function decodeTemplate(dataUrl: string): Buffer {
  const match = DATA_URL_RE.exec(dataUrl);
  if (!match) throw new InvalidTemplateError();
  const bytes = Buffer.from(match[2], "base64");
  if (bytes.length === 0) throw new InvalidTemplateError("The card template is empty");
  return bytes;
}

function escapeXml(value: string): string {
  return value.replace(/[<>&"']/g, (character) => {
    switch (character) {
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case "&":
        return "&amp;";
      case '"':
        return "&quot;";
      default:
        return "&apos;";
    }
  });
}

/**
 * Approximate the width of bold sans-serif text and shorten it with an ellipsis
 * when it cannot fit. (SVG has no automatic wrapping/ellipsis in librsvg.)
 */
function fitText(text: string, fontSize: number, maxWidth: number): string {
  const approximateCharWidth = fontSize * 0.58;
  const maxChars = Math.max(4, Math.floor(maxWidth / approximateCharWidth));
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(1, maxChars - 1)).trimEnd()}…`;
}

export interface GuestCardInput {
  templateDataUrl: string;
  guestName: string;
  eventTitle: string;
  qrToken: string;
}

export interface GuestCardResult {
  png: Buffer;
  width: number;
  height: number;
}

export async function renderGuestCard(input: GuestCardInput): Promise<GuestCardResult> {
  const template = decodeTemplate(input.templateDataUrl);

  const metadata = await sharp(template).metadata();
  const width = metadata.width ?? 1080;
  const height = metadata.height ?? 1350;

  const marginX = Math.max(24, Math.round(width * 0.05));
  const marginY = Math.max(20, Math.round(height * 0.05));

  // QR in a white rounded box, bottom-right.
  const qrSize = Math.max(150, Math.min(380, Math.round(Math.min(width, height) * 0.26)));
  const qrPad = Math.round(qrSize * 0.06);
  const qrBox = qrSize + qrPad * 2;
  const qrX = width - marginX - qrBox;
  const qrY = height - marginY - qrBox;

  const bandHeight = Math.max(150, Math.round(height * 0.3));
  const textX = marginX;
  const textMaxWidth = Math.max(120, width - marginX * 2 - qrBox - Math.round(width * 0.02));

  const subtitleSize = Math.max(15, Math.min(34, Math.round(width * 0.024)));
  let nameSize = Math.max(26, Math.min(76, Math.round(width * 0.052)));
  while (nameSize > 18 && input.guestName.length * nameSize * 0.58 > textMaxWidth) nameSize -= 2;

  const guestName = fitText(input.guestName, nameSize, textMaxWidth);
  const eventTitle = fitText(input.eventTitle, subtitleSize, textMaxWidth);

  const subtitleY = height - marginY;
  const nameY = subtitleY - Math.round(subtitleSize * 2.1);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <defs>
      <linearGradient id="shade" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#000000" stop-opacity="0"/>
        <stop offset="0.55" stop-color="#000000" stop-opacity="0.35"/>
        <stop offset="1" stop-color="#000000" stop-opacity="0.82"/>
      </linearGradient>
    </defs>
    <rect x="0" y="${height - bandHeight}" width="${width}" height="${bandHeight}" fill="url(#shade)"/>
    <rect x="${qrX}" y="${qrY}" width="${qrBox}" height="${qrBox}" rx="16" fill="#ffffff"/>
    <text x="${textX}" y="${nameY}" font-family="Segoe UI, Arial, Helvetica, sans-serif" font-size="${nameSize}" font-weight="700" fill="#ffffff">${escapeXml(guestName)}</text>
    <text x="${textX}" y="${subtitleY}" font-family="Segoe UI, Arial, Helvetica, sans-serif" font-size="${subtitleSize}" font-weight="500" fill="#e5e7eb">${escapeXml(eventTitle)}</text>
  </svg>`;

  const qrPng = await renderQrPng(input.qrToken);
  const qrScaled = await sharp(qrPng)
    .resize(qrSize, qrSize, { kernel: "nearest" })
    .png()
    .toBuffer();

  const png = await sharp(template)
    .composite([
      { input: Buffer.from(svg) },
      { input: qrScaled, left: qrX + qrPad, top: qrY + qrPad },
    ])
    .flatten({ background: "#ffffff" })
    .png({ compressionLevel: 9 })
    .toBuffer();

  return { png, width, height };
}
