import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/lib/auth";
import { signSessionToken } from "@/lib/jwt";
import { cookies } from "next/headers";

const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { identifier, password } = body;

    if (typeof identifier !== "string" || !identifier.trim() || typeof password !== "string" || !password) {
      return NextResponse.json({ error: "Please enter your credentials and password" }, { status: 400 });
    }

    const normalizedIdentifier = identifier.trim();

    // Find user matching email, username, or phone
    const user = await prisma.user.findFirst({
      where: {
        OR: [
          { email: { equals: normalizedIdentifier, mode: "insensitive" } },
          { username: { equals: normalizedIdentifier, mode: "insensitive" } },
          { phone: { equals: normalizedIdentifier, mode: "insensitive" } }
        ]
      },
    });

    if (!user) {
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }

    const isPasswordValid = await verifyPassword(password, user.passwordHash);

    if (!isPasswordValid) {
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
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

    // Return success along with the role so the frontend knows where to redirect
    return NextResponse.json({
      success: true,
      role: user.role,
      message: "Logged in successfully"
    }, { status: 200 });

  } catch (error: unknown) {
    console.error("Login error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
