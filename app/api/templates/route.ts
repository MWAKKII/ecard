import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";

/**
 * Card designs an organizer may assign to an event (Step 8).
 * Only ACTIVE designs are exposed — the image itself is served separately by
 * /api/templates/[id]/image so this list stays small.
 */
export async function GET() {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const templates = await prisma.cardTemplate.findMany({
      where: { status: "ACTIVE" },
      select: { id: true, title: true },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json(templates);
  } catch (error) {
    console.error("Template list error:", error);
    return NextResponse.json({ error: "Unable to load card designs" }, { status: 500 });
  }
}
