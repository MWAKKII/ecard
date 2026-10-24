-- AlterTable
ALTER TABLE "card_templates" ADD COLUMN     "layout" JSONB,
ALTER COLUMN "imageUrl" DROP DEFAULT;

-- AlterTable
ALTER TABLE "guests" ADD COLUMN     "cardFingerprint" TEXT,
ADD COLUMN     "cardPng" BYTEA;
