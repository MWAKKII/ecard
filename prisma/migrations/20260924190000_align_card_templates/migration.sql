-- Align the existing card_templates table with the current Prisma model.
ALTER TABLE "card_templates" RENAME COLUMN "name" TO "title";

ALTER TABLE "card_templates"
  ADD COLUMN "imageUrl" TEXT NOT NULL DEFAULT '';

ALTER TABLE "card_templates" DROP COLUMN "design";
