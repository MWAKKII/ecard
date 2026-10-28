import { NextResponse } from "next/server";
import sharp from "sharp";
import type { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/session";
import { analyzeTemplateLayout, type TemplateLayout } from "@/lib/template-layout";
import { recordAudit, clientIp } from "@/lib/audit";
import { readJsonBody } from "@/lib/request";
import { takeRateLimit, rateLimitResponse } from "@/lib/rate-limit";

/**
 * Card design templates (Step 10 groundwork).
 * Designs are uploaded from the admin's PC as an image file and stored as a
 * base64 data URL in `imageUrl` - there is no longer any price, description
 * or remote-URL entry (see migration 20261021110000).
 */

const MAX_IMAGE_BYTES = 4 * 1024 * 1024; // 4 MB after decoding
const MAX_BODY_BYTES = 6 * 1024 * 1024; // base64 expansion + JSON overhead
const MAX_TITLE_LENGTH = 120;
const MAX_IMAGE_DIMENSION = 10_000;
const MAX_IMAGE_PIXELS = 40_000_000;

/** data:image/<type>;base64,<payload> */
const DATA_URL_RE = /^data:image\/(png|jpeg|webp|gif|avif);base64,([A-Za-z0-9+/]+={0,2})$/;

/** Sharp reports AVIF as `heif` (and on some builds also `avif`). */
const EXPECTED_FORMATS: Record<string, string[]> = {
  png: ["png"],
  jpeg: ["jpeg"],
  webp: ["webp"],
  gif: ["gif"],
  avif: ["heif", "avif"],
};

/** Confirm the decoded bytes really are an image before storing them. */
function hasImageSignature(bytes: Buffer): boolean {
  if (bytes.length < 12) return false;
  // PNG
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return true;
  // JPEG
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return true;
  // GIF
  if (bytes.subarray(0, 6).toString("ascii").startsWith("GIF8")) return true;
  // WEBP / AVIF: RIFF....WEBP or ....ftyp
  const head = bytes.subarray(0, 12).toString("binary");
  if (head.startsWith("RIFF") && head.slice(8, 12) === "WEBP") return true;
  if (head.slice(4, 8) === "ftyp") return true;
  return false;
}

export async function GET() {
  try {
    if (!(await requireAdmin())) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const templates = await prisma.cardTemplate.findMany({
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { events: true } } },
    });
    return NextResponse.json(templates, { status: 200 });
  } catch (error: unknown) {
    console.error("Template list error:", error);
    return NextResponse.json({ error: "Unable to load card designs" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const admin = await requireAdmin();
    if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const limit = takeRateLimit(
      `template:upload:${admin.userId}`,
      20,
      60 * 60 * 1000,
    );
    if (!limit.allowed) {
      return rateLimitResponse(limit, "Too many design uploads. Try again later.");
    }

    const parsed = await readJsonBody(request, MAX_BODY_BYTES);
    if (!parsed.ok) return parsed.response;

    const title = typeof parsed.body.title === "string" ? parsed.body.title.trim() : "";
    const imageUrl = typeof parsed.body.imageUrl === "string" ? parsed.body.imageUrl : "";

    if (!title) {
      return NextResponse.json({ error: "A design title is required" }, { status: 400 });
    }
    if (title.length > MAX_TITLE_LENGTH) {
      return NextResponse.json(
        { error: `Design title must be ${MAX_TITLE_LENGTH} characters or fewer.` },
        { status: 400 },
      );
    }
    if (!imageUrl) {
      return NextResponse.json({ error: "Choose an image file to upload" }, { status: 400 });
    }

    const match = DATA_URL_RE.exec(imageUrl);
    if (!match) {
      return NextResponse.json(
        { error: "The uploaded file must be a PNG, JPEG, WebP, GIF or AVIF image" },
        { status: 400 },
      );
    }

    const mimeType = match[1];
    const bytes = Buffer.from(match[2], "base64");
    if (bytes.length === 0) {
      return NextResponse.json({ error: "The uploaded image is empty" }, { status: 400 });
    }
    if (bytes.length > MAX_IMAGE_BYTES) {
      return NextResponse.json(
        { error: `Images must be smaller than ${MAX_IMAGE_BYTES / (1024 * 1024)} MB` },
        { status: 413 },
      );
    }
    if (!hasImageSignature(bytes)) {
      return NextResponse.json({ error: "That file does not look like a valid image" }, { status: 400 });
    }

    // Decode the image with Sharp to reject spoofed files, truncated data and
    // decompression bombs. The declared MIME type must match the real format.
    let metadata: { format?: string; width?: number; height?: number };
    try {
      metadata = await sharp(bytes, {
        limitInputPixels: MAX_IMAGE_PIXELS,
        failOn: "error",
      }).metadata();
    } catch {
      return NextResponse.json({ error: "That file does not look like a valid image" }, { status: 400 });
    }

    const format = metadata.format;
    if (!format || !(EXPECTED_FORMATS[mimeType] ?? []).includes(format)) {
      return NextResponse.json(
        { error: "The image content does not match its file type" },
        { status: 400 },
      );
    }

    const width = metadata.width ?? 0;
    const height = metadata.height ?? 0;
    if (
      width < 1 ||
      height < 1 ||
      width > MAX_IMAGE_DIMENSION ||
      height > MAX_IMAGE_DIMENSION ||
      width * height > MAX_IMAGE_PIXELS
    ) {
      return NextResponse.json(
        { error: "The image dimensions are too large. Use an image no larger than 10000 x 10000 pixels." },
        { status: 413 },
      );
    }

    // Read the design's placeholder words once, at upload time. A design
    // without placeholders still gets an empty layout marker, so renders never
    // have to retry OCR.
    let layout: TemplateLayout | null = null;
    try {
      layout = await analyzeTemplateLayout(imageUrl);
    } catch (error) {
      console.error("Template layout analysis failed; using fallback layout:", error);
    }

    const newTemplate = await prisma.cardTemplate.create({
      data: {
        title,
        imageUrl,
        status: "ACTIVE",
        createdById: admin.userId,
        ...(layout ? { layout: layout as unknown as Prisma.InputJsonValue } : {}),
      },
    });

    await recordAudit({
      actorId: admin.userId,
      action: "template.uploaded",
      entityType: "card_template",
      entityId: newTemplate.id,
      metadata: {
        title,
        format,
        width,
        height,
        bytes: bytes.length,
      },
      ipAddress: clientIp(request),
    });

    return NextResponse.json({ success: true, template: newTemplate }, { status: 201 });
  } catch (error: unknown) {
    console.error("Template upload error:", error);
    return NextResponse.json({ error: "Unable to upload the card design" }, { status: 500 });
  }
}
