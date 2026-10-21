import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";

export async function GET() {
  try {
    const templates = await prisma.cardTemplate.findMany({
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json(templates, { status: 200 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    // Get logged in admin ID from cookie
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (session.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const body = await request.json();
    const { title, description, imageUrl, price } = body;

    if (!title || !imageUrl) {
      return NextResponse.json({ error: "Title and Image URL are required" }, { status: 400 });
    }

    const newTemplate = await prisma.cardTemplate.create({
      data: {
        title,
        description: description || "",
        imageUrl,
        price: price ? parseFloat(price) : 0.00,
        createdById: session.userId,
      },
    });

    return NextResponse.json({ success: true, template: newTemplate }, { status: 201 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}