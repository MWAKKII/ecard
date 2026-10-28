import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { readJsonBody } from "@/lib/request";
import { takeRateLimit, rateLimitResponse } from "@/lib/rate-limit";

const PHONE_PATTERN = /^\+?[0-9][0-9\s\-()]{5,19}$/;
const MAX_NAME_LENGTH = 120;
const MAX_USERNAME_LENGTH = 30;

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { id: session.userId },
      select: { id: true, name: true, email: true, username: true, phone: true },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    return NextResponse.json(user, { status: 200 });
  } catch (error: unknown) {
    console.error("Profile fetch error:", error);
    return NextResponse.json({ error: "Unable to load your profile" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const limit = takeRateLimit(`profile:update:${session.userId}`, 30, 60 * 1000);
    if (!limit.allowed) {
      return rateLimitResponse(limit, "Too many profile updates. Try again later.");
    }

    const parsed = await readJsonBody(request, 64 * 1024);
    if (!parsed.ok) return parsed.response;

    const { name, username, phone } = parsed.body;
    const data: { name?: string; username?: string; phone?: string | null } = {};

    if (name !== undefined) {
      if (typeof name !== "string") {
        return NextResponse.json({ error: "Name must be text." }, { status: 400 });
      }
      const cleanName = name.trim();
      if (!cleanName) {
        return NextResponse.json({ error: "Name is required." }, { status: 400 });
      }
      if (cleanName.length > MAX_NAME_LENGTH) {
        return NextResponse.json(
          { error: `Name must be ${MAX_NAME_LENGTH} characters or fewer.` },
          { status: 400 },
        );
      }
      data.name = cleanName;
    }

    if (username !== undefined) {
      if (typeof username !== "string") {
        return NextResponse.json({ error: "Username must be text." }, { status: 400 });
      }
      const cleanUsername = username.trim();
      if (cleanUsername.length < 3 || cleanUsername.length > MAX_USERNAME_LENGTH) {
        return NextResponse.json(
          { error: `Username must be between 3 and ${MAX_USERNAME_LENGTH} characters.` },
          { status: 400 },
        );
      }
      data.username = cleanUsername;
    }

    if (phone !== undefined) {
      if (typeof phone !== "string") {
        return NextResponse.json({ error: "Phone number must be text." }, { status: 400 });
      }
      const cleanPhone = phone.trim();
      if (!cleanPhone) {
        data.phone = null;
      } else {
        const digits = cleanPhone.replace(/\D/g, "");
        if (
          cleanPhone.length > 30 ||
          !PHONE_PATTERN.test(cleanPhone) ||
          digits.length < 7 ||
          digits.length > 15
        ) {
          return NextResponse.json(
            { error: "Please enter a valid phone number." },
            { status: 400 },
          );
        }
        data.phone = cleanPhone;
      }
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
    }

    try {
      const updatedUser = await prisma.user.update({
        where: { id: session.userId },
        data,
        select: { id: true, name: true, email: true, username: true, phone: true },
      });

      return NextResponse.json({ success: true, user: updatedUser }, { status: 200 });
    } catch (error: unknown) {
      if (isUniqueConstraintError(error)) {
        return NextResponse.json(
          { error: "That username or phone number is already in use." },
          { status: 409 },
        );
      }
      throw error;
    }
  } catch (error: unknown) {
    console.error("Profile update error:", error);
    return NextResponse.json({ error: "Unable to update your profile" }, { status: 500 });
  }
}
