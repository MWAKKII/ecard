import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";

type RouteContext = { params: Promise<{ id: string }> };

const DATA_URL_RE = /^data:image\/(png|jpeg|webp|gif|avif);base64,([A-Za-z0-9+/]+={0,2})$/;

const CONTENT_TYPES: Record<string, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
};

/**
 * Serves a card design image as binary instead of embedding the multi-megabyte
 * base64 data URL in the template list. Cached privately per browser.
 */
export async function GET(_request: Request, { params }: RouteContext) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    const template = await prisma.cardTemplate.findFirst({
      where: { id, status: "ACTIVE" },
      select: { imageUrl: true },
    });
    if (!template) return NextResponse.json({ error: "Design not found" }, { status: 404 });

    const match = DATA_URL_RE.exec(template.imageUrl);
    if (!match) return NextResponse.json({ error: "Design image is unavailable" }, { status: 500 });

    const bytes = Buffer.from(match[2], "base64");

    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": CONTENT_TYPES[match[1]] ?? "application/octet-stream",
        "Content-Length": String(bytes.length),
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("Template image error:", error);
    return NextResponse.json({ error: "Unable to load the design image" }, { status: 500 });
  }
}
