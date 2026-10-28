import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { loadImageSource } from "@/lib/object-storage";
import { logError } from "@/lib/logger";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Serves a card design image as binary. Admins may preview every design;
 * organizers may only preview ACTIVE designs. The image may live in private
 * Supabase Storage or in a legacy base64 data URL.
 *
 * Cached privately per browser. The image endpoint is the only place that
 * resolves storage references for the client, so bucket/path details never
 * need to be exposed to the browser.
 */
export async function GET(_request: Request, { params }: RouteContext) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    const template = await prisma.cardTemplate.findFirst({
      where: {
        id,
        ...(session.role === "ADMIN" ? {} : { status: "ACTIVE" }),
      },
      select: { imageUrl: true },
    });
    if (!template) return NextResponse.json({ error: "Design not found" }, { status: 404 });

    const image = await loadImageSource(template.imageUrl);

    return new NextResponse(new Uint8Array(image.bytes), {
      status: 200,
      headers: {
        "Content-Type": image.contentType,
        "Content-Length": String(image.bytes.length),
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    logError("Template image error", error);
    return NextResponse.json({ error: "Unable to load the design image" }, { status: 500 });
  }
}
