import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashPassword, validateEmail, validatePassword, normalizeEmail } from "@/lib/auth";
import { signSessionToken } from "@/lib/jwt";
import { cookies } from "next/headers";

const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days
const PHONE_PATTERN = /^\+?[0-9][0-9\s\-()]{5,19}$/;

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { email, password, name, username, phone } = body;

    // Step 4: validation for email, password and required fields.
    const emailError = validateEmail(email);
    if (emailError) return NextResponse.json({ error: emailError }, { status: 400 });

    const passwordError = validatePassword(password);
    if (passwordError) return NextResponse.json({ error: passwordError }, { status: 400 });

    const cleanUsername = typeof username === "string" ? username.trim() : "";
    if (cleanUsername.length < 3 || cleanUsername.length > 30) {
      return NextResponse.json({ error: "Username must be between 3 and 30 characters." }, { status: 400 });
    }

    const cleanPhone = typeof phone === "string" ? phone.trim() : "";
    if (!cleanPhone || !PHONE_PATTERN.test(cleanPhone)) {
      return NextResponse.json({ error: "Please enter a valid phone number." }, { status: 400 });
    }

    const cleanEmail = normalizeEmail(email);
    const cleanName = typeof name === "string" && name.trim() ? name.trim() : cleanUsername;

    // Check if email, username, or phone already exists
    const existingUser = await prisma.user.findFirst({
      where: {
        OR: [
          { email: { equals: cleanEmail, mode: "insensitive" } },
          { username: { equals: cleanUsername, mode: "insensitive" } },
          { phone: { equals: cleanPhone, mode: "insensitive" } },
        ],
      },
    });

    if (existingUser) {
      if (existingUser.email.toLowerCase() === cleanEmail) {
        return NextResponse.json({ error: "Email is already registered" }, { status: 400 });
      }
      if (existingUser.username?.toLowerCase() === cleanUsername.toLowerCase()) {
        return NextResponse.json({ error: "Username is already taken" }, { status: 400 });
      }
      if (existingUser.phone?.replace(/\s/g, "") === cleanPhone.replace(/\s/g, "")) {
        return NextResponse.json({ error: "Phone number is already in use" }, { status: 400 });
      }
    }

    const hashedPassword = await hashPassword(password);

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
      if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
        return NextResponse.json({ error: "Email, username or phone is already registered" }, { status: 409 });
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

    return NextResponse.json({ success: true, role: user.role, message: "Account created successfully." }, { status: 201 });
  } catch (error: unknown) {
    console.error("Signup error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
