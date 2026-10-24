import sharp from "sharp";
import { renderQrPng } from "@/lib/qr";
import type { QrPlaceholder, TemplateLayout, TextPlaceholder } from "@/lib/template-layout";

/**
 * Personalized e-card renderer (spec: CARD TEMPLATE + Guest Name + QR → PNG).
 *
 * If the template contains the known placeholder words, `layout` (detected
 * once by lib/template-layout) tells us exactly where the event title, guest
 * name, card quality and QR belong. We erase the placeholder words using their
 * sampled local background and draw the real values in place.
 *
 * Templates without placeholders keep the original template-agnostic layout:
 * a dark gradient across the bottom and a QR in a white rounded box.
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
function approximateWidth(text: string, fontSize: number, fontWeight: number): number {
  let units = 0;
  for (const character of text) {
    if (character === " ") units += 0.28;
    else if (/[A-Z]/.test(character)) units += 0.62;
    else if (/[a-z]/.test(character)) units += 0.5;
    else if (/[0-9]/.test(character)) units += 0.55;
    else if (/[.,:;'’!|]/.test(character)) units += 0.24;
    else units += 0.42;
  }
  return units * fontSize * (fontWeight >= 600 ? 1.04 : 1);
}

function ellipsize(text: string, fontSize: number, fontWeight: number, maxWidth: number): string {
  if (approximateWidth(text, fontSize, fontWeight) <= maxWidth) return text;
  let result = text;
  while (result.length > 1 && approximateWidth(`${result}…`, fontSize, fontWeight) > maxWidth) {
    result = result.slice(0, -1).trimEnd();
  }
  return `${result}…`;
}

interface TextFit {
  lines: string[];
  fontSize: number;
}

function fitSingleLine(
  text: string,
  startSize: number,
  fontWeight: number,
  maxWidth: number,
  minRatio = 0.4,
): TextFit {
  let fontSize = startSize;
  const minSize = Math.max(10, Math.round(startSize * minRatio));
  while (fontSize > minSize && approximateWidth(text, fontSize, fontWeight) > maxWidth) {
    fontSize -= 2;
  }
  return {
    lines: [ellipsize(text, fontSize, fontWeight, maxWidth)],
    fontSize,
  };
}

function splitTwoLines(text: string): [string, string] | null {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length < 2) return null;

  let best: { first: string; second: string; width: number } | null = null;
  for (let index = 1; index < words.length; index += 1) {
    const first = words.slice(0, index).join(" ");
    const second = words.slice(index).join(" ");
    const width = Math.max(first.length, second.length);
    if (!best || width < best.width) best = { first, second, width };
  }
  return best ? [best.first, best.second] : null;
}

function fitText(
  text: string,
  startSize: number,
  fontWeight: number,
  maxWidth: number,
  maxLines: number,
): TextFit {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return { lines: [""], fontSize: startSize };

  const single = fitSingleLine(clean, startSize, fontWeight, maxWidth);
  const singleFits = approximateWidth(clean, single.fontSize, fontWeight) <= maxWidth;

  if (maxLines < 2) return single;

  const split = splitTwoLines(clean);
  if (!split) return single;

  let fontSize = startSize;
  const minSize = Math.max(10, Math.round(startSize * 0.45));
  const twoLineWidth = (size: number) =>
    Math.max(
      approximateWidth(split[0], size, fontWeight),
      approximateWidth(split[1], size, fontWeight),
    );
  while (fontSize > minSize && twoLineWidth(fontSize) > maxWidth) {
    fontSize -= 2;
  }
  const twoLines = [
    ellipsize(split[0], fontSize, fontWeight, maxWidth),
    ellipsize(split[1], fontSize, fontWeight, maxWidth),
  ];
  const twoFits = twoLineWidth(fontSize) <= maxWidth;

  // Prefer the option that keeps the text larger — a long event title is
  // better on two lines than squeezed into one tiny line.
  if (twoFits && (!singleFits || fontSize > single.fontSize)) {
    return { lines: twoLines, fontSize };
  }
  return single;
}

interface RawPixels {
  data: Buffer;
  width: number;
  height: number;
  channels: number;
}

async function readRawPixels(template: Buffer): Promise<RawPixels> {
  const { data, info } = await sharp(template)
    .flatten({ background: "#ffffff" })
    .toColourspace("srgb")
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, channels: info.channels };
}

function pixelAt(raw: RawPixels, x: number, y: number): [number, number, number] {
  const px = Math.min(raw.width - 1, Math.max(0, x));
  const py = Math.min(raw.height - 1, Math.max(0, y));
  const index = (py * raw.width + px) * raw.channels;
  if (raw.channels === 1) {
    const value = raw.data[index];
    return [value, value, value];
  }
  return [raw.data[index], raw.data[index + 1], raw.data[index + 2]];
}

function median(values: number[]): number {
  values.sort((a, b) => a - b);
  return values[Math.floor((values.length - 1) / 2)];
}

function rgbHex(red: number, green: number, blue: number): string {
  const part = (value: number) =>
    Math.min(255, Math.max(0, Math.round(value))).toString(16).padStart(2, "0");
  return `#${part(red)}${part(green)}${part(blue)}`;
}

interface BackgroundFill {
  defs: string;
  svg: string;
}

/**
 * Build a seamless background patch using the template's own pixels just left
 * and right of the placeholder. Sampling every row (and interpolating between
 * the left and right edge colors) preserves the design's diagonal gradients,
 * unlike a single fill which leaves a visible box.
 */
function rowBackgroundSvg(raw: RawPixels, slot: TextPlaceholder, idPrefix: string): BackgroundFill | null {
  if (slot.x < 0 || slot.y < 0 || slot.x + slot.width > raw.width || slot.y + slot.height > raw.height) {
    return null;
  }

  const sampleWidth = Math.max(4, Math.round(slot.height * 0.2));
  const leftStart = Math.max(0, slot.x - sampleWidth);
  const leftEnd = slot.x;
  const rightStart = slot.x + slot.width;
  const rightEnd = Math.min(raw.width, rightStart + sampleWidth);
  if (leftEnd <= leftStart && rightEnd <= rightStart) return null;

  interface Run {
    y: number;
    height: number;
    left: string;
    right: string;
  }
  const runs: Run[] = [];
  let currentLeft = "";
  let currentRight = "";
  let runStart = slot.y;

  const flush = (endY: number) => {
    if (currentLeft && endY > runStart) {
      runs.push({ y: runStart, height: endY - runStart, left: currentLeft, right: currentRight });
    }
  };

  const medianSide = (y: number, start: number, end: number): string | null => {
    if (end <= start) return null;
    const reds: number[] = [];
    const greens: number[] = [];
    const blues: number[] = [];
    for (let x = start; x < end; x += 2) {
      const [red, green, blue] = pixelAt(raw, x, y);
      reds.push(red);
      greens.push(green);
      blues.push(blue);
    }
    if (reds.length === 0) return null;
    return rgbHex(median(reds), median(greens), median(blues));
  };

  for (let y = slot.y; y < slot.y + slot.height; y += 1) {
    const leftColor = medianSide(y, leftStart, leftEnd);
    const rightColor = medianSide(y, rightStart, rightEnd);
    if (!leftColor && !rightColor) return null;
    const left = leftColor ?? rightColor!;
    const right = rightColor ?? leftColor!;
    if (left !== currentLeft || right !== currentRight) {
      flush(y);
      currentLeft = left;
      currentRight = right;
      runStart = y;
    }
  }
  flush(slot.y + slot.height);

  const defs: string[] = [];
  const rects = runs.map((run, index) => {
    if (run.left === run.right) {
      return `<rect x="${slot.x}" y="${run.y}" width="${slot.width}" height="${run.height}" fill="${run.left}"/>`;
    }
    const gradientId = `${idPrefix}-row-${index}`;
    defs.push(
      `<linearGradient id="${gradientId}" x1="${slot.x}" y1="0" x2="${slot.x + slot.width}" y2="0" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${run.left}"/><stop offset="1" stop-color="${run.right}"/></linearGradient>`,
    );
    return `<rect x="${slot.x}" y="${run.y}" width="${slot.width}" height="${run.height}" fill="url(#${gradientId})"/>`;
  });

  return { defs: defs.join("\n      "), svg: rects.join("\n    ") };
}

function textSvg(
  slot: TextPlaceholder,
  text: string,
  id: string,
  maxLines: number,
  width: number,
  background: BackgroundFill | null,
): { defs: string; svg: string } {
  const centerX = slot.x + slot.width / 2;
  const edgeLimit = Math.max(40, 2 * Math.min(centerX, width - centerX) - 32);
  const maxWidth = Math.min(slot.width * 1.18, width * 0.92, edgeLimit);
  const fit = fitText(text, slot.fontSize, slot.fontWeight, maxWidth, maxLines);
  const lineGap = Math.round(fit.fontSize * 1.15);
  const centerY = slot.y + slot.height / 2;
  const firstBaseline =
    centerY - ((fit.lines.length - 1) * lineGap) / 2 + fit.fontSize * 0.35;

  const lines = fit.lines
    .map(
      (line, index) =>
        `<text x="${centerX}" y="${firstBaseline + index * lineGap}" text-anchor="middle" font-family="Arial Narrow, Liberation Sans Narrow, DejaVu Sans Condensed, Arial, Helvetica, sans-serif" font-size="${fit.fontSize}" font-weight="${slot.fontWeight}" fill="${slot.color}">${escapeXml(line)}</text>`,
    )
    .join("\n    ");

  if (background) {
    return { defs: background.defs, svg: `${background.svg}\n    ${lines}` };
  }

  const gradientId = `bg-${id}`;
  const defs = `<linearGradient id="${gradientId}" x1="0" y1="${slot.y}" x2="0" y2="${slot.y + slot.height}" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="${slot.backgroundTop}"/>
      <stop offset="1" stop-color="${slot.backgroundBottom}"/>
    </linearGradient>`;

  return {
    defs,
    svg: `<rect x="${slot.x}" y="${slot.y}" width="${slot.width}" height="${slot.height}" fill="url(#${gradientId})"/>
    ${lines}`,
  };
}

function qrSvg(qr: QrPlaceholder): string {
  if (qr.drawBackground) {
    const radius = Math.round(Math.min(qr.width, qr.height) * 0.08);
    return `<rect x="${qr.x}" y="${qr.y}" width="${qr.width}" height="${qr.height}" rx="${radius}" fill="#ffffff"/>`;
  }
  return `<rect x="${qr.text.x}" y="${qr.text.y}" width="${qr.text.width}" height="${qr.text.height}" fill="${qr.background}"/>`;
}

export interface GuestCardInput {
  templateDataUrl: string;
  guestName: string;
  eventTitle: string;
  qrToken: string;
  cardType?: string;
  layout?: TemplateLayout | null;
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

  const layout = input.layout;
  const layoutMatches =
    layout &&
    layout.width === width &&
    layout.height === height &&
    layout.placeholders.guestName &&
    layout.placeholders.qr;

  if (layoutMatches) {
    return renderFromLayout(template, input, layout, width, height);
  }
  return renderLegacy(template, input, width, height);
}

async function renderFromLayout(
  template: Buffer,
  input: GuestCardInput,
  layout: TemplateLayout,
  width: number,
  height: number,
): Promise<GuestCardResult> {
  const defs: string[] = [];
  const layers: string[] = [];

  let raw: RawPixels | null = null;
  try {
    raw = await readRawPixels(template);
  } catch (error) {
    console.error("[cards] could not sample template background:", error);
  }
  const backgroundFor = (slot: TextPlaceholder, id: string) =>
    raw ? rowBackgroundSvg(raw, slot, id) : null;

  if (layout.placeholders.eventTitle) {
    const slot = textSvg(
      layout.placeholders.eventTitle,
      input.eventTitle,
      "title",
      2,
      width,
      backgroundFor(layout.placeholders.eventTitle, "title"),
    );
    defs.push(slot.defs);
    layers.push(slot.svg);
  }

  if (layout.placeholders.guestName) {
    const slot = textSvg(
      layout.placeholders.guestName,
      input.guestName,
      "name",
      1,
      width,
      backgroundFor(layout.placeholders.guestName, "name"),
    );
    defs.push(slot.defs);
    layers.push(slot.svg);
  }

  if (layout.placeholders.quality) {
    const quality = input.cardType?.toUpperCase() === "PREMIUM" ? "Premium" : "Standard";
    const slot = textSvg(
      layout.placeholders.quality,
      quality,
      "quality",
      1,
      width,
      backgroundFor(layout.placeholders.quality, "quality"),
    );
    defs.push(slot.defs);
    layers.push(slot.svg);
  }

  const qr = layout.placeholders.qr;
  if (!qr) throw new InvalidTemplateError("The card template has no QR placeholder");
  layers.push(qrSvg(qr));

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <defs>
      ${defs.join("\n      ")}
    </defs>
    ${layers.join("\n    ")}
  </svg>`;

  const qrSize = Math.max(80, Math.round(Math.min(qr.width, qr.height) * 0.84));
  const qrX = qr.x + Math.round((qr.width - qrSize) / 2);
  const qrY = qr.y + Math.round((qr.height - qrSize) / 2);

  const qrPng = await renderQrPng(input.qrToken);
  const qrScaled = await sharp(qrPng)
    .resize(qrSize, qrSize, { kernel: "nearest" })
    .png()
    .toBuffer();

  const png = await sharp(template)
    .composite([
      { input: Buffer.from(svg) },
      { input: qrScaled, left: qrX, top: qrY },
    ])
    .flatten({ background: "#ffffff" })
    .png({ compressionLevel: 9 })
    .toBuffer();

  return { png, width, height };
}

/** Template-agnostic fallback for designs without detected placeholders. */
async function renderLegacy(
  template: Buffer,
  input: GuestCardInput,
  width: number,
  height: number,
): Promise<GuestCardResult> {
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

  const guestName = ellipsize(input.guestName, nameSize, 700, textMaxWidth);
  const eventTitle = ellipsize(input.eventTitle, subtitleSize, 500, textMaxWidth);

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
