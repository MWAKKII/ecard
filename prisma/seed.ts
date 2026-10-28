import "dotenv/config";
import { hash } from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../app/generated/prisma/client";
import { validateDatabaseUrl } from "../lib/database-url";

function createClient() {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Add your Supabase connection string to .env before seeding.",
    );
  }

  validateDatabaseUrl(connectionString);

  return new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });
}

const prisma = createClient();

const pricingTiers = [
  {
    label: "Small events",
    minGuests: 1,
    maxGuests: 100,
    price: 750,
  },
  {
    label: "Medium events",
    minGuests: 101,
    maxGuests: 200,
    price: 650,
  },
];

async function main() {
  const adminEmail = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase() || "mwakki@ecard.local";
  const adminUsername = process.env.SEED_ADMIN_USERNAME?.trim() || "Mwakki";
  const adminPassword = process.env.SEED_ADMIN_PASSWORD?.trim();

  if (!adminPassword) {
    throw new Error(
      "SEED_ADMIN_PASSWORD is required. Set a strong, unique admin password before seeding.",
    );
  }
  if (adminPassword.length < 12) {
    throw new Error("SEED_ADMIN_PASSWORD must be at least 12 characters long.");
  }
  if (/^(replace|change[-_ ]?me|password|qwertyuiop)/i.test(adminPassword)) {
    throw new Error(
      "SEED_ADMIN_PASSWORD is a placeholder or known default. Choose a unique password.",
    );
  }

  const passwordHash = await hash(adminPassword, 12);

  const existingAdmin = await prisma.user.findUnique({ where: { username: adminUsername } })
    || await prisma.user.findUnique({ where: { email: adminEmail } });
  const admin = existingAdmin
    ? await prisma.user.update({
        where: { id: existingAdmin.id },
        data: {
          email: existingAdmin.email,
          username: adminUsername,
          name: "Mwakki Admin",
          passwordHash,
          role: "ADMIN",
          authorizationStatus: "APPROVED",
        },
      })
    : await prisma.user.create({
        data: {
          email: adminEmail,
          username: adminUsername,
          name: "Mwakki Admin",
          passwordHash,
          role: "ADMIN",
          authorizationStatus: "APPROVED",
        },
      });

  for (const tier of pricingTiers) {
    const existingTier = await prisma.pricingTier.findFirst({
      where: { minGuests: tier.minGuests, maxGuests: tier.maxGuests },
    });
    if (existingTier) {
      await prisma.pricingTier.update({
        where: { id: existingTier.id },
        data: { active: true },
      });
    } else {
      await prisma.pricingTier.create({
        data: {
          minGuests: tier.minGuests,
          maxGuests: tier.maxGuests,
          price: tier.price,
          active: true,
        },
      });
    }
  }

  await prisma.auditLog.create({
    data: {
      actorId: admin.id,
      action: "seed.completed",
      entityType: "User",
      entityId: admin.id,
      metadata: {
        pricingTiers: pricingTiers.map((tier) => tier.label),
      },
    },
  });

  console.log(`Seeded admin user: ${admin.email}`);
  console.log(
    `Seeded pricing tiers: ${pricingTiers.map((tier) => tier.label).join(", ")}`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
