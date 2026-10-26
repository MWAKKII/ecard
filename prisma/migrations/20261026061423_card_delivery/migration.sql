-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('NOT_SENT', 'NOT_CONFIGURED', 'SENT', 'FAILED');

-- Existing guests start at NOT_SENT. Legacy cardStatus = 'SENT' is not copied:
-- that status came from a browser share/manual download, not a provider
-- confirmation, so treating it as a successful WhatsApp delivery would be fake.

-- AlterTable
ALTER TABLE "guests" ADD COLUMN     "deliveredAt" TIMESTAMP(3),
ADD COLUMN     "deliveryError" TEXT,
ADD COLUMN     "deliveryMessageId" TEXT,
ADD COLUMN     "deliveryProvider" TEXT,
ADD COLUMN     "deliveryStatus" "DeliveryStatus" NOT NULL DEFAULT 'NOT_SENT';

-- CreateIndex
CREATE INDEX "guests_deliveryStatus_idx" ON "guests"("deliveryStatus");
