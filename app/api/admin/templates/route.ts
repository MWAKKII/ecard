import { NextResponse } from "next/server";
import type { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/session";
import { analyzeTemplateLayout, type TemplateLayout } from "@/lib/template-layout";

/**
 * Card design templates (Step 10 groundwork).
 * Designs are uploaded from the admin's PC as an image file and stored as a
 * base64 data URL in `imageUrl` — there is no longer any price, description
 * or remote-URL entry (see migration 20261021110000).
 */

const MAX_IMAGE_BYTES = 4 * 1024 * 1024; // 4 MB after decoding

/** data:image/<type>;base64,<payload> */
const DATA_URL_RE = /^data:image\/(png|jpeg|webp|gif|avif);base64,([A-Za-z0-9+/]+={0,2})$/;

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
    if (!(await requireAdmin())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const templates = await prisma.cardTemplate.findMany({
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { events: true } } },
    });
    return NextResponse.json(templates, { status: 200 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const admin = await requireAdmin();
    if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const title = typeof body.title === "string" ? body.title.trim() : "";
    const imageUrl = typeof body.imageUrl === "string" ? body.imageUrl : "";

    if (!title) return NextResponse.json({ error: "A design title is required" }, { status: 400 });
    if (!imageUrl) return NextResponse.json({ error: "Choose an image file to upload" }, { status: 400 });

    const match = DATA_URL_RE.exec(imageUrl);
    if (!match) {
      return NextResponse.json(
        { error: "The uploaded file must be a PNG, JPEG, WebP, GIF or AVIF image" },
        { status: 400 },
      );
    }

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

    return NextResponse.json({ success: true, template: newTemplate }, { status: 201 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
