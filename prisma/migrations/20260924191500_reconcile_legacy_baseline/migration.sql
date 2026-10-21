-- Reconciles pre-existing gaps between the migration chain and prisma/schema.prisma.
--
-- The database this project was developed against was shaped largely by
-- `prisma db push`, so several schema pieces (PricingTier table name/columns,
-- users.username/phone, events.guestCount, events.endsAt nullability, the
-- Invitation table, and the PaymentStatus enum values) never appeared in any
-- migration. Every statement below is guarded (IF [NOT] EXISTS) so the
-- migration is safe both on a fresh replay of this chain and on a database
-- that already has these objects.

-- ---------------------------------------------------------------------------
-- 1) PricingTier: the Prisma model has no @@map, so Prisma reads/writes a
--    table named "PricingTier". The init migration instead created
--    "pricing_tiers" with a different column set.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "PricingTier" (
    "id" UUID NOT NULL,
    "minGuests" INTEGER NOT NULL,
    "maxGuests" INTEGER NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "PricingTier_pkey" PRIMARY KEY ("id")
);

-- Carry legacy tier rows over (merge semantics: only rows whose id is not yet
-- in "PricingTier" are inserted).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'pricing_tiers' AND c.relkind = 'r'
  ) THEN
    INSERT INTO "PricingTier" ("id", "minGuests", "maxGuests", "price", "active")
    SELECT
      p."id",
      1,
      COALESCE(p."maxGuests", 1000000),
      p."price"::double precision,
      p."isActive"
    FROM "pricing_tiers" p
    ON CONFLICT ("id") DO NOTHING;
  END IF;
END $$;

-- Re-point the foreign keys that init created against "pricing_tiers".
ALTER TABLE "events" DROP CONSTRAINT IF EXISTS "events_pricingTierId_fkey";
ALTER TABLE "payments" DROP CONSTRAINT IF EXISTS "payments_pricingTierId_fkey";

ALTER TABLE "events"
  ADD CONSTRAINT "events_pricingTierId_fkey"
  FOREIGN KEY ("pricingTierId") REFERENCES "PricingTier"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "payments"
  ADD CONSTRAINT "payments_pricingTierId_fkey"
  FOREIGN KEY ("pricingTierId") REFERENCES "PricingTier"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Legacy table has been merged; nothing references it any more.
DROP TABLE IF EXISTS "pricing_tiers";

-- ---------------------------------------------------------------------------
-- 2) users: username / phone (nullable unique, per schema).
-- ---------------------------------------------------------------------------
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "username" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "phone" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "users_username_key" ON "users"("username");
CREATE UNIQUE INDEX IF NOT EXISTS "users_phone_key" ON "users"("phone");

-- ---------------------------------------------------------------------------
-- 3) events: guestCount column and endsAt becoming optional.
-- ---------------------------------------------------------------------------
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "guestCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "events" ALTER COLUMN "endsAt" DROP NOT NULL;

-- ---------------------------------------------------------------------------
-- 4) invitations: model Invitation has no @@map, so the table is "Invitation".
--    No migration ever created it.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "Invitation" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "templateTheme" TEXT NOT NULL DEFAULT 'classic-blue',
    "customMessage" TEXT,
    "accentColor" TEXT NOT NULL DEFAULT '#2563eb',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invitation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "Invitation_eventId_key" ON "Invitation"("eventId");
ALTER TABLE "Invitation" DROP CONSTRAINT IF EXISTS "Invitation_eventId_fkey";
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_eventId_fkey"
  FOREIGN KEY ("eventId") REFERENCES "events"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 5) PaymentStatus: init created (PENDING, AUTHORIZED, PAID, FAILED,
--    REFUNDED, CANCELLED); the schema uses (PENDING, SUBMITTED, VERIFIED,
--    REJECTED). The payment_workflow migration contains a guarded block that
--    only fires when a "PaymentStatus_old" type exists — a type no migration
--    ever creates — so the conversion never actually happened. Do it here,
--    reusing the value mapping that block intended.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'PaymentStatus' AND e.enumlabel = 'VERIFIED'
  ) THEN
    RETURN; -- already converted (e.g. database shaped by prisma db push)
  END IF;

  CREATE TYPE "PaymentStatus_new" AS ENUM ('PENDING', 'SUBMITTED', 'VERIFIED', 'REJECTED');

  ALTER TABLE "payments" ALTER COLUMN "status" DROP DEFAULT;
  ALTER TABLE "payments" ALTER COLUMN "status" TYPE "PaymentStatus_new" USING (
    CASE "status"::text
      WHEN 'AUTHORIZED' THEN 'VERIFIED'
      WHEN 'PAID' THEN 'VERIFIED'
      WHEN 'FAILED' THEN 'REJECTED'
      WHEN 'REFUNDED' THEN 'REJECTED'
      WHEN 'CANCELLED' THEN 'REJECTED'
      ELSE "status"::text -- PENDING
    END
  )::"PaymentStatus_new";

  ALTER TYPE "PaymentStatus" RENAME TO "PaymentStatus_old";
  ALTER TYPE "PaymentStatus_new" RENAME TO "PaymentStatus";
  ALTER TABLE "payments" ALTER COLUMN "status" SET DEFAULT 'PENDING';
  DROP TYPE "PaymentStatus_old";
END $$;
