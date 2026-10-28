import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { hashPassword, validateEmail, validatePassword, normalizeEmail } from "@/lib/auth";
import { signSessionToken } from "@/lib/jwt";
import { readJsonBody } from "@/lib/request";
import { takeRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { requestIp } from "@/lib/client-ip";

const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days
const MAX_BODY_BYTES = 32 * 1024;
const SIGNUP_WINDOW_MS = 60 * 60 * 1000;
const PHONE_PATTERN = /^\+?[0-9][0-9\s\-()]{5,19}$/;
const MAX_NAME_LENGTH = 120;

export async function POST(request: Request) {
  try {
    const ip = requestIp(request) ?? "unknown";
    const ipLimit = takeRateLimit(`auth:signup:ip:${ip}`, 20, SIGNUP_WINDOW_MS);
    if (!ipLimit.allowed) {
      return rateLimitResponse(ipLimit, "Too many signup attempts. Try again later.");
    }

    const parsed = await readJsonBody(request, MAX_BODY_BYTES);
    if (!parsed.ok) return parsed.response;

    const { email, password, name, username, phone } = parsed.body;

    // Validation for email, password and required fields.
    const emailError = validateEmail(email);
    if (emailError) return NextResponse.json({ error: emailError }, { status: 400 });

    const passwordError = validatePassword(password);
    if (passwordError) return NextResponse.json({ error: passwordError }, { status: 400 });

    const cleanUsername = typeof username === "string" ? username.trim() : "";
    if (cleanUsername.length < 3 || cleanUsername.length > 30) {
      return NextResponse.json(
        { error: "Username must be between 3 and 30 characters." },
        { status: 400 },
      );
    }

    const cleanPhone = typeof phone === "string" ? phone.trim() : "";
    if (!cleanPhone || !PHONE_PATTERN.test(cleanPhone)) {
      return NextResponse.json({ error: "Please enter a valid phone number." }, { status: 400 });
    }

    const rawName = typeof name === "string" ? name.trim() : "";
    if (rawName.length > MAX_NAME_LENGTH) {
      return NextResponse.json(
        { error: `Name must be ${MAX_NAME_LENGTH} characters or fewer.` },
        { status: 400 },
      );
    }

    const cleanEmail = normalizeEmail(email as string);
    const cleanName = rawName || cleanUsername;

    const emailLimit = takeRateLimit(
      `auth:signup:id:${cleanEmail}`,
      5,
      SIGNUP_WINDOW_MS,
    );
    if (!emailLimit.allowed) {
      return rateLimitResponse(emailLimit, "Too many signup attempts. Try again later.");
    }

    // Hash before the duplicate lookup so an existing account does not answer
    // noticeably faster than a new one (account-enumeration timing).
    const hashedPassword = await hashPassword(password as string);

    // Check if email, username, or phone already exists.
    const existingUser = await prisma.user.findFirst({
      where: {
        OR: [
          { email: { equals: cleanEmail, mode: "insensitive" } },
          { username: { equals: cleanUsername, mode: "insensitive" } },
          { phone: { equals: cleanPhone, mode: "insensitive" } },
        ],
      },
      select: { id: true },
    });

    if (existingUser) {
      return NextResponse.json(
        { error: "An account with those details already exists." },
        { status: 409 },
      );
    }

    let user;
    try {
      user = await prisma.user.create({
        data: {
          email: cleanEmail,
          username: cleanUsername,
          phone: cleanPhone,
          passwordHash: hashedPassword,
          name: cleanName,
        },
      });
    } catch (error: unknown) {
      // Race with a concurrent signup: the unique constraints are the final word.
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code?: unknown }).code === "P2002"
      ) {
        return NextResponse.json(
          { error: "An account with those details already exists." },
          { status: 409 },
        );
      }
      throw error;
    }

    const token = signSessionToken({ userId: user.id, email: user.email, role: user.role });

    const cookieStore = await cookies();
    cookieStore.set({
      name: "auth_token",
      value: token,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_MAX_AGE,
    });

    return NextResponse.json(
      { success: true, role: user.role, message: "Account created successfully." },
      { status: 201 },
    );
  } catch (error: unknown) {
    console.error("Signup error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
