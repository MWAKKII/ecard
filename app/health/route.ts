import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logError } from "@/lib/logger";

/**
 * Health check (Step 1 — "a /health page that returns OK and optionally
 * checks the DB"). Unauthenticated and cheap; the DB probe is best-effort
 * so the endpoint still answers when the database is briefly unavailable.
 */
export async function GET() {
  const base = {
    status: "ok" as "ok" | "degraded",
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
  };

  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ ...base, database: "up" }, { status: 200 });
  } catch (error) {
    logError("Health check database probe failed", error);
    return NextResponse.json(
      { ...base, status: "degraded" as const, database: "down" },
      { status: 503 },
    );
  }
}
