import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../app/generated/prisma/client";
import { validateDatabaseUrl } from "@/lib/database-url";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrismaClient() {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Add your Supabase connection string to .env.",
    );
  }

  validateDatabaseUrl(connectionString);

  // Vercel/serverless instances are reused for many invocations. A single
  // connection per instance avoids exhausting Supabase's pooler; local
  // development keeps a larger pool for parallel work.
  const adapter = new PrismaPg({
    connectionString,
    max: process.env.NODE_ENV === "production" ? 1 : 10,
  });
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
