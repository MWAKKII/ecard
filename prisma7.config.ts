import "dotenv/config";
import { defineConfig } from "prisma/config";

function migrationUrl() {
  const directUrl = process.env.DIRECT_URL;
  const databaseUrl = process.env.DATABASE_URL;
  const url = directUrl || databaseUrl;

  if (!url) {
    throw new Error(
      "Set DIRECT_URL (recommended for Supabase migrations) or DATABASE_URL in .env.",
    );
  }

  return url;
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: migrationUrl(),
  },
});
