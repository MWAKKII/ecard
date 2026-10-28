import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/lib/auth";
import { signSessionToken } from "@/lib/jwt";
import { readJsonBody } from "@/lib/request";
import { takeRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { requestIp } from "@/lib/client-ip";

const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days
const MAX_BODY_BYTES = 32 * 1024;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

// A valid bcrypt hash used when the identifier does not exist, so a missing
// account and a wrong password take approximately the same time to reject.
const DUMMY_PASSWORD_HASH = "$2b$10$Pcu8EDuDelhjE8Bdw5U9PedpPP2L3EJwVSPE9OFGey99HqWRkhPZa";

export async function POST(request: Request) {
  try {
    const ip = requestIp(request) ?? "unknown";
    const ipLimit = takeRateLimit(`auth:login:ip:${ip}`, 50, LOGIN_WINDOW_MS);
    if (!ipLimit.allowed) {
      return rateLimitResponse(ipLimit, "Too many login attempts. Try again later.");
    }

    const parsed = await readJsonBody(request, MAX_BODY_BYTES);
    if (!parsed.ok) return parsed.response;

    const { identifier, password } = parsed.body;

    if (
      typeof identifier !== "string" ||
      !identifier.trim() ||
      typeof password !== "string" ||
      !password ||
      identifier.trim().length > 254 ||
      password.length > 200
    ) {
      return NextResponse.json(
        { error: "Please enter your credentials and password" },
        { status: 400 },
      );
    }

    const normalizedIdentifier = identifier.trim();

    const accountLimit = takeRateLimit(
      `auth:login:id:${normalizedIdentifier.toLowerCase()}`,
      10,
      LOGIN_WINDOW_MS,
    );
    if (!accountLimit.allowed) {
      return rateLimitResponse(
        accountLimit,
        "Too many login attempts. Try again later.",
      );
    }

    // Find user matching email, username, or phone.
    const user = await prisma.user.findFirst({
      where: {
        OR: [
          { email: { equals: normalizedIdentifier, mode: "insensitive" } },
          { username: { equals: normalizedIdentifier, mode: "insensitive" } },
          { phone: { equals: normalizedIdentifier, mode: "insensitive" } },
        ],
      },
    });

    const isPasswordValid = await verifyPassword(
      password,
      user?.passwordHash ?? DUMMY_PASSWORD_HASH,
    );

    if (!user || !isPasswordValid) {
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }

    if (
      user.authorizationStatus === "REJECTED" ||
      user.authorizationStatus === "SUSPENDED"
    ) {
      return NextResponse.json(
        { error: "This account is not permitted to sign in. Contact an administrator." },
        { status: 403 },
      );
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

    // Return success along with the role so the frontend knows where to redirect.
    return NextResponse.json(
      {
        success: true,
        role: user.role,
        message: "Logged in successfully",
      },
      { status: 200 },
    );
  } catch (error: unknown) {
    console.error("Login error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
