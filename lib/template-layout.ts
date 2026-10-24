import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";

/**
 * Card-template analysis (OCR).
 *
 * Designs may contain the literal placeholder words
 *
 *   “TITLE EVENT”        → event title
 *   “GUESTS NAME”        → guest name
 *   QR CODE GOES HERE    → guest QR (inside its white panel)
 *   Card Quality         → STANDARD / PREMIUM
 *
 * We locate those words once, when a design is uploaded, and store their pixel
 * boxes + sampled colors in `card_templates.layout`. Rendering then only needs
 * sharp — no OCR on every guest card. Designs without placeholders keep the
 * legacy template-agnostic layout.
 */

export interface LayoutBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TextPlaceholder extends LayoutBox {
  /** Sampled background just above / below the words (for a matching fill). */
  backgroundTop: string;
  backgroundBottom: string;
  /** Sampled original text color. */
  color: string;
  /** Approximate original font size in px. */
  fontSize: number;
  fontWeight: number;
}

export interface QrPlaceholder extends LayoutBox {
  /** Bounding box of the placeholder words, erased before the QR is placed. */
  text: LayoutBox;
  background: string;
  /** True when no white panel was found and the renderer must draw one. */
  drawBackground: boolean;
}

export interface TemplateLayout {
  version: 1;
  width: number;
  height: number;
  placeholders: {
    eventTitle?: TextPlaceholder;
    guestName?: TextPlaceholder;
    quality?: TextPlaceholder;
    qr?: QrPlaceholder;
  };
}

interface OcrLine {
  text: string;
  normalized: string;
  confidence: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

interface Rgb {
  r: number;
  g: number;
  b: number;
}

interface RawImage {
  data: Buffer;
  width: number;
  height: number;
  channels: number;
}

type SharpPipeline = ReturnType<typeof sharp>;

const DATA_URL_RE = /^data:image\/(png|jpeg|webp|gif|avif);base64,([A-Za-z0-9+/]+={0,2})$/;

function decodeImage(dataUrl: string): Buffer {
  const match = DATA_URL_RE.exec(dataUrl);
  if (!match) throw new Error("The card template is not a valid image data URL");
  const bytes = Buffer.from(match[2], "base64");
  if (bytes.length === 0) throw new Error("The card template is empty");
  return bytes;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clampBox(box: LayoutBox, width: number, height: number): LayoutBox {
  const x = clamp(Math.round(box.x), 0, Math.max(0, width - 1));
  const y = clamp(Math.round(box.y), 0, Math.max(0, height - 1));
  return {
    x,
    y,
    width: clamp(Math.round(box.width), 1, width - x),
    height: clamp(Math.round(box.height), 1, height - y),
  };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function readBox(value: unknown): LayoutBox | null {
  if (!value || typeof value !== "object") return null;
  const box = value as Record<string, unknown>;
  const x = box.x;
  const y = box.y;
  const width = box.width;
  const height = box.height;
  if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(width) || !isFiniteNumber(height)) {
    return null;
  }
  if (width <= 0 || height <= 0) return null;
  return { x, y, width, height };
}

function readOcrBbox(value: unknown): { x0: number; y0: number; x1: number; y1: number } | null {
  if (!value || typeof value !== "object") return null;
  const box = value as Record<string, unknown>;
  const x0 = box.x0;
  const y0 = box.y0;
  const x1 = box.x1;
  const y1 = box.y1;
  if (!isFiniteNumber(x0) || !isFiniteNumber(y0) || !isFiniteNumber(x1) || !isFiniteNumber(y1)) {
    return null;
  }
  if (x1 <= x0 || y1 <= y0) return null;
  return { x0, y0, x1, y1 };
}

function readTextPlaceholder(value: unknown): TextPlaceholder | null {
  const box = readBox(value);
  if (!box || !value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (
    typeof raw.backgroundTop !== "string" ||
    typeof raw.backgroundBottom !== "string" ||
    typeof raw.color !== "string" ||
    !isFiniteNumber(raw.fontSize) ||
    !isFiniteNumber(raw.fontWeight)
  ) {
    return null;
  }
  return {
    ...box,
    backgroundTop: raw.backgroundTop,
    backgroundBottom: raw.backgroundBottom,
    color: raw.color,
    fontSize: raw.fontSize,
    fontWeight: raw.fontWeight,
  };
}

function readQrPlaceholder(value: unknown): QrPlaceholder | null {
  const box = readBox(value);
  if (!box || !value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const text = readBox(raw.text);
  if (!text || typeof raw.background !== "string" || typeof raw.drawBackground !== "boolean") return null;
  return {
    ...box,
    text,
    background: raw.background,
    drawBackground: raw.drawBackground,
  };
}

/** Validate a layout loaded from JSON/Prisma. Empty layouts (no placeholders) are valid. */
export function parseTemplateLayout(value: unknown): TemplateLayout | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (raw.version !== 1 || !isFiniteNumber(raw.width) || !isFiniteNumber(raw.height)) return null;
  if (raw.width <= 0 || raw.height <= 0 || !raw.placeholders || typeof raw.placeholders !== "object") return null;

  const placeholders = raw.placeholders as Record<string, unknown>;
  const layout: TemplateLayout = {
    version: 1,
    width: Math.round(raw.width),
    height: Math.round(raw.height),
    placeholders: {},
  };

  const title = readTextPlaceholder(placeholders.eventTitle);
  const guest = readTextPlaceholder(placeholders.guestName);
  const quality = readTextPlaceholder(placeholders.quality);
  const qr = readQrPlaceholder(placeholders.qr);
  if (title) layout.placeholders.eventTitle = title;
  if (guest) layout.placeholders.guestName = guest;
  if (quality) layout.placeholders.quality = quality;
  if (qr) layout.placeholders.qr = qr;
  return layout;
}

/** A layout can only drive the personalized renderer with a name + QR slot. */
export function isUsableTemplateLayout(
  layout: TemplateLayout | null | undefined,
): layout is TemplateLayout & { placeholders: { guestName: TextPlaceholder; qr: QrPlaceholder } } {
  return Boolean(layout?.placeholders.guestName && layout.placeholders.qr);
}

function normalizeLine(text: string): string {
  return text
    .replace(/[“”„‟«»"'’‘]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  values.sort((a, b) => a - b);
  return values[Math.floor((values.length - 1) / 2)];
}

function toHex(color: Rgb): string {
  const part = (value: number) => clamp(Math.round(value), 0, 255).toString(16).padStart(2, "0");
  return `#${part(color.r)}${part(color.g)}${part(color.b)}`;
}

function luminance(color: Rgb): number {
  return 0.299 * color.r + 0.587 * color.g + 0.114 * color.b;
}

function mixColor(from: Rgb, to: Rgb, t: number): Rgb {
  return {
    r: from.r + (to.r - from.r) * t,
    g: from.g + (to.g - from.g) * t,
    b: from.b + (to.b - from.b) * t,
  };
}

async function readRaw(bytes: Buffer): Promise<RawImage> {
  const { data, info } = await sharp(bytes)
    .flatten({ background: "#ffffff" })
    .toColourspace("srgb")
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, channels: info.channels };
}

function pixelAt(raw: RawImage, x: number, y: number): Rgb {
  const px = clamp(Math.round(x), 0, raw.width - 1);
  const py = clamp(Math.round(y), 0, raw.height - 1);
  const index = (py * raw.width + px) * raw.channels;
  if (raw.channels === 1) {
    const value = raw.data[index];
    return { r: value, g: value, b: value };
  }
  return { r: raw.data[index], g: raw.data[index + 1], b: raw.data[index + 2] };
}

/** Median color of a rectangle, sampling every few pixels for speed. */
function medianRegion(raw: RawImage, x: number, y: number, width: number, height: number): Rgb {
  const x0 = clamp(Math.round(x), 0, raw.width - 1);
  const y0 = clamp(Math.round(y), 0, raw.height - 1);
  const x1 = clamp(Math.round(x + width), x0 + 1, raw.width);
  const y1 = clamp(Math.round(y + height), y0 + 1, raw.height);
  const reds: number[] = [];
  const greens: number[] = [];
  const blues: number[] = [];
  const step = Math.max(1, Math.floor(Math.sqrt(((x1 - x0) * (y1 - y0)) / 1200)));
  for (let py = y0; py < y1; py += step) {
    for (let px = x0; px < x1; px += step) {
      const color = pixelAt(raw, px, py);
      reds.push(color.r);
      greens.push(color.g);
      blues.push(color.b);
    }
  }
  return { r: median(reds), g: median(greens), b: median(blues) };
}

function contrastColor(background: Rgb): Rgb {
  return luminance(background) > 150 ? { r: 20, g: 20, b: 20 } : { r: 255, g: 255, b: 255 };
}

/** Average of the pixels that differ most from the local background (the text). */
function sampleTextColor(
  raw: RawImage,
  line: OcrLine,
  slot: LayoutBox,
  backgroundTop: Rgb,
  backgroundBottom: Rgb,
): Rgb {
  const samples: { distance: number; color: Rgb }[] = [];
  const x0 = clamp(line.bbox.x0, 0, raw.width - 1);
  const x1 = clamp(line.bbox.x1, x0 + 1, raw.width);
  const y0 = clamp(line.bbox.y0, 0, raw.height - 1);
  const y1 = clamp(line.bbox.y1, y0 + 1, raw.height);

  for (let y = y0; y < y1; y += 2) {
    const t = clamp((y - slot.y) / Math.max(1, slot.height), 0, 1);
    const background = mixColor(backgroundTop, backgroundBottom, t);
    for (let x = x0; x < x1; x += 2) {
      const color = pixelAt(raw, x, y);
      const distance = Math.hypot(color.r - background.r, color.g - background.g, color.b - background.b);
      samples.push({ distance, color });
    }
  }

  if (samples.length === 0) return contrastColor(backgroundTop);
  samples.sort((a, b) => b.distance - a.distance);
  const take = Math.max(12, Math.floor(samples.length * 0.04));
  const strongest = samples.slice(0, take);
  const average = strongest.reduce(
    (sum, sample) => {
      sum.r += sample.color.r;
      sum.g += sample.color.g;
      sum.b += sample.color.b;
      return sum;
    },
    { r: 0, g: 0, b: 0 },
  );
  average.r /= strongest.length;
  average.g /= strongest.length;
  average.b /= strongest.length;

  const backgroundAtText = mixColor(backgroundTop, backgroundBottom, 0.5);
  const distance = Math.hypot(
    average.r - backgroundAtText.r,
    average.g - backgroundAtText.g,
    average.b - backgroundAtText.b,
  );
  return distance >= 45 ? average : contrastColor(backgroundAtText);
}

/** Find the large near-white panel that contains the "QR CODE GOES HERE" words. */
function findQrPanel(
  raw: RawImage,
  textBox: { x0: number; y0: number; x1: number; y1: number },
): { box: LayoutBox; background: Rgb } | null {
  const { width, height, channels, data } = raw;
  const textWidth = Math.max(1, textBox.x1 - textBox.x0);
  const textHeight = Math.max(1, textBox.y1 - textBox.y0);
  const textArea = textWidth * textHeight;
  const centerX = Math.round((textBox.x0 + textBox.x1) / 2);
  const centerY = Math.round((textBox.y0 + textBox.y1) / 2);

  const isWhite = (index: number) => {
    const offset = index * channels;
    if (channels === 1) return data[offset] >= 235;
    return data[offset] >= 235 && data[offset + 1] >= 235 && data[offset + 2] >= 235;
  };

  const maxArea = Math.floor(width * height * 0.55);
  let best: { box: LayoutBox; background: Rgb; area: number } | null = null;

  for (const factor of [1, 2, 3, 4]) {
    const distance = Math.max(8, Math.round(textHeight * 0.9 * factor));
    const candidates: [number, number][] = [
      [textBox.x0 - distance, centerY],
      [textBox.x1 + distance, centerY],
      [centerX, textBox.y0 - distance],
      [centerX, textBox.y1 + distance],
      [textBox.x0 - distance, textBox.y0 - distance],
      [textBox.x1 + distance, textBox.y1 + distance],
    ];

    for (const [startX, startY] of candidates) {
      if (startX < 0 || startY < 0 || startX >= width || startY >= height) continue;
      const start = startY * width + startX;
      if (!isWhite(start)) continue;

      const visited = new Uint8Array(width * height);
      const stack: number[] = [start];
      visited[start] = 1;
      let area = 0;
      let minX = startX;
      let maxX = startX;
      let minY = startY;
      let maxY = startY;
      let aborted = false;

      while (stack.length > 0) {
        const index = stack.pop()!;
        if (!isWhite(index)) continue;
        const x = index % width;
        const y = (index / width) | 0;
        area += 1;
        if (area > maxArea) {
          aborted = true;
          break;
        }
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;

        if (x > 0) {
          const next = index - 1;
          if (!visited[next]) {
            visited[next] = 1;
            stack.push(next);
          }
        }
        if (x + 1 < width) {
          const next = index + 1;
          if (!visited[next]) {
            visited[next] = 1;
            stack.push(next);
          }
        }
        if (y > 0) {
          const next = index - width;
          if (!visited[next]) {
            visited[next] = 1;
            stack.push(next);
          }
        }
        if (y + 1 < height) {
          const next = index + width;
          if (!visited[next]) {
            visited[next] = 1;
            stack.push(next);
          }
        }
      }

      if (aborted || area < textArea * 1.5) continue;
      const box: LayoutBox = { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
      const containsText =
        box.x <= textBox.x0 + 2 &&
        box.y <= textBox.y0 + 2 &&
        box.x + box.width >= textBox.x1 - 2 &&
        box.y + box.height >= textBox.y1 - 2;
      const aspect = box.width / Math.max(1, box.height);
      if (!containsText || aspect < 0.45 || aspect > 2.4) continue;
      if (!best || area > best.area) {
        best = { box, background: pixelAt(raw, startX, startY), area };
      }
    }

    if (best) break;
  }

  return best ? { box: best.box, background: best.background } : null;
}

function buildTextPlaceholder(
  raw: RawImage,
  line: OcrLine,
  fontWeight: number,
): TextPlaceholder | null {
  const lineHeight = Math.max(1, line.bbox.y1 - line.bbox.y0);
  const padX = Math.max(3, Math.round(lineHeight * 0.2));
  const padY = Math.max(3, Math.round(lineHeight * 0.25));

  const slot = clampBox(
    {
      x: line.bbox.x0 - padX,
      y: line.bbox.y0 - padY,
      width: line.bbox.x1 - line.bbox.x0 + padX * 2,
      height: lineHeight + padY * 2,
    },
    raw.width,
    raw.height,
  );

  const stripHeight = Math.max(3, Math.round(slot.height * 0.3));
  const above =
    slot.y >= stripHeight
      ? medianRegion(raw, slot.x, slot.y - stripHeight, slot.width, stripHeight)
      : null;
  const below =
    slot.y + slot.height + stripHeight <= raw.height
      ? medianRegion(raw, slot.x, slot.y + slot.height, slot.width, stripHeight)
      : null;
  const backgroundTop = above ?? below;
  const backgroundBottom = below ?? above;
  if (!backgroundTop || !backgroundBottom) return null;

  const color = sampleTextColor(raw, line, slot, backgroundTop, backgroundBottom);
  const fontSize = clamp(Math.round(lineHeight / 0.72), 10, Math.round(raw.height * 0.25));

  return {
    ...slot,
    backgroundTop: toHex(backgroundTop),
    backgroundBottom: toHex(backgroundBottom),
    color: toHex(color),
    fontSize,
    fontWeight,
  };
}

async function collectLines(bytes: Buffer): Promise<OcrLine[]> {
  const metadata = await sharp(bytes).metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  if (!width || !height) throw new Error("The template image has no readable dimensions");

  const scale = width < 900 ? Math.min(2, 1400 / width) : 1;
  const resize = (pipeline: SharpPipeline) =>
    scale > 1 ? pipeline.resize({ width: Math.round(width * scale), kernel: "lanczos3" }) : pipeline;

  const image = () => sharp(bytes).flatten({ background: "#ffffff" }).toColourspace("srgb");
  const variants = [
    await resize(image()).png().toBuffer(),
    await resize(image().grayscale().threshold(190).negate().removeAlpha()).png().toBuffer(),
    await resize(image().grayscale().threshold(235).negate().removeAlpha()).png().toBuffer(),
  ];

  // Resolve the language data through the filesystem rather than
  // require.resolve: the production server bundle rewrites require.resolve to
  // an internal module id, which is why `path` received a number.
  const dataRoot = [
    path.join(process.cwd(), "node_modules", "@tesseract.js-data", "eng"),
    path.join(process.cwd(), "..", "node_modules", "@tesseract.js-data", "eng"),
  ].find((candidate) => existsSync(candidate));
  if (!dataRoot) throw new Error("Tesseract English language data was not found");
  const preferred = path.join(dataRoot, "4.0.0_best_int");
  const langPath = existsSync(preferred) ? preferred : path.join(dataRoot, "4.0.0");
  if (!existsSync(langPath)) throw new Error("Tesseract English language data was not found");

  const { createWorker, PSM } = await import("tesseract.js");
  const worker = await createWorker("eng", 1, {
    langPath,
    cachePath: path.join(os.tmpdir(), "ecard-tesseract"),
    logger: () => {},
  });

  const byText = new Map<string, OcrLine>();
  try {
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });

    for (const variant of variants) {
      const result = await worker.recognize(variant, {}, { blocks: true });
      const data = result.data as unknown as {
        blocks?: Array<{ paragraphs?: Array<{ lines?: Array<{ text?: string; confidence?: number; bbox?: unknown }> }> }> | null;
      };

      for (const block of data.blocks ?? []) {
        for (const paragraph of block.paragraphs ?? []) {
          for (const line of paragraph.lines ?? []) {
            if (!line.text || !line.bbox) continue;
            const box = readOcrBbox(line.bbox);
            if (!box) continue;
            const text = line.text.trim();
            const normalized = normalizeLine(text);
            if (!normalized) continue;

            const candidate: OcrLine = {
              text,
              normalized,
              confidence: line.confidence ?? 0,
              bbox: {
                x0: Math.round(box.x0 / scale),
                y0: Math.round(box.y0 / scale),
                x1: Math.round(box.x1 / scale),
                y1: Math.round(box.y1 / scale),
              },
            };
            const existing = byText.get(normalized);
            if (!existing || candidate.confidence > existing.confidence) byText.set(normalized, candidate);
          }
        }
      }
    }
  } finally {
    await worker.terminate();
  }

  return [...byText.values()];
}

function unionLines(lines: OcrLine[]) {
  const x0 = Math.min(...lines.map((line) => line.bbox.x0));
  const y0 = Math.min(...lines.map((line) => line.bbox.y0));
  const x1 = Math.max(...lines.map((line) => line.bbox.x1));
  const y1 = Math.max(...lines.map((line) => line.bbox.y1));
  return { x0, y0, x1, y1 };
}

/**
 * Analyze a design and return its detected placeholders. An object with an
 * empty `placeholders` map is still returned (and persisted) when OCR succeeds
 * but no known words are present, so we never retry OCR on every render.
 */
export async function analyzeTemplateLayout(dataUrl: string): Promise<TemplateLayout> {
  const bytes = decodeImage(dataUrl);
  const raw = await readRaw(bytes);
  const lines = await collectLines(bytes);

  const titleLine = lines
    .filter((line) => /\btitle\s+event\b/.test(line.normalized))
    .sort((a, b) => b.confidence - a.confidence)[0];

  const guestLine = lines
    .filter((line) => /\bguests?\s+name\b/.test(line.normalized))
    .sort((a, b) => b.confidence - a.confidence)[0];

  const qualityLine = lines
    .filter((line) => /\b(card\s+)?quality\b/.test(line.normalized))
    .sort((a, b) => b.confidence - a.confidence)[0];

  const qrLines = lines.filter((line) => /\bqr\s+code\b|\bgoes\s+here\b/.test(line.normalized));
  const qrText = qrLines.length > 0 ? unionLines(qrLines) : null;

  const placeholders: TemplateLayout["placeholders"] = {};
  if (titleLine) {
    const slot = buildTextPlaceholder(raw, titleLine, 700);
    if (slot) placeholders.eventTitle = slot;
  }
  if (guestLine) {
    const slot = buildTextPlaceholder(raw, guestLine, 700);
    if (slot) placeholders.guestName = slot;
  }
  if (qualityLine) {
    const slot = buildTextPlaceholder(raw, qualityLine, 400);
    if (slot) placeholders.quality = slot;
  }

  if (qrText) {
    const qrLineHeight = Math.max(12, qrText.y1 - qrText.y0);
    const padX = Math.max(6, Math.round(qrLineHeight * 0.35));
    const padY = Math.max(4, Math.round(qrLineHeight * 0.25));
    const textSlot = clampBox(
      {
        x: qrText.x0 - padX,
        y: qrText.y0 - padY,
        width: qrText.x1 - qrText.x0 + padX * 2,
        height: qrText.y1 - qrText.y0 + padY * 2,
      },
      raw.width,
      raw.height,
    );

    const panel = findQrPanel(raw, qrText);
    if (panel) {
      placeholders.qr = {
        ...clampBox(panel.box, raw.width, raw.height),
        text: textSlot,
        background: toHex(panel.background),
        drawBackground: false,
      };
    } else {
      const side = Math.min(
        Math.round(Math.max((qrText.x1 - qrText.x0) * 1.7, qrLineHeight * 3.6, 120)),
        Math.min(raw.width, raw.height),
      );
      const centerX = (qrText.x0 + qrText.x1) / 2;
      const centerY = (qrText.y0 + qrText.y1) / 2;
      placeholders.qr = {
        ...clampBox(
          { x: centerX - side / 2, y: centerY - side / 2, width: side, height: side },
          raw.width,
          raw.height,
        ),
        text: textSlot,
        background: "#ffffff",
        drawBackground: true,
      };
    }
  }

  return { version: 1, width: raw.width, height: raw.height, placeholders };
}

/** Opaque marker so a successfully analyzed design is not OCR'd again. */
export function emptyTemplateLayout(width: number, height: number): TemplateLayout {
  return { version: 1, width, height, placeholders: {} };
}
