import "dotenv/config";
import { prisma } from "../lib/prisma";
import { getWhatsAppDeliveryConfig, sendWhatsAppCard } from "../lib/whatsapp-delivery";

/**
 * Real provider integration check. Sends an existing generated card to
 * WHATSAPP_TEST_RECIPIENT. This does not update guest delivery status; use the
 * app for normal delivery.
 */
async function main() {
  const to = process.env.WHATSAPP_TEST_RECIPIENT?.trim();
  if (!to) {
    throw new Error("Set WHATSAPP_TEST_RECIPIENT in .env first.");
  }

  const config = getWhatsAppDeliveryConfig();
  console.log("WhatsApp config:", config);
  if (!config.configured) {
    throw new Error(
      "WhatsApp delivery is not configured. Set WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID.",
    );
  }

  const guest = await prisma.guest.findFirst({
    where: { cardPng: { not: null } },
    orderBy: { updatedAt: "desc" },
    select: {
      fullName: true,
      cardPng: true,
      event: { select: { title: true } },
    },
  });
  if (!guest?.cardPng) {
    throw new Error("No generated guest card found to use for the test.");
  }

  const result = await sendWhatsAppCard({
    to,
    png: new Uint8Array(guest.cardPng),
    fileName: "whatsapp-delivery-test.png",
    caption: `Test card for ${guest.fullName} (${guest.event.title}).`,
    guestName: guest.fullName,
    eventTitle: guest.event.title,
  });

  console.log("Delivery result:", result);
  if (!result.ok) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
