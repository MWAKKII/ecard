import "dotenv/config";
import { prisma } from "../lib/prisma";

async function main() {
  const [users, pricingTiers, events, guests, attendances, cardTemplates, payments, auditLogs] =
    await Promise.all([
      prisma.user.count(),
      prisma.pricingTier.count(),
      prisma.event.count(),
      prisma.guest.count(),
      prisma.attendance.count(),
      prisma.cardTemplate.count(),
      prisma.payment.count(),
      prisma.auditLog.count(),
    ]);

  console.table({
    users,
    pricingTiers,
    events,
    guests,
    attendances,
    cardTemplates,
    payments,
    auditLogs,
  });
}

main()
  .catch((error) => {
    console.error("Database verification failed.");
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
