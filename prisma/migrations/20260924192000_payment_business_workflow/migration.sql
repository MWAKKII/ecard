ALTER TYPE "EventStatus" ADD VALUE IF NOT EXISTS 'AUTHORIZED';
ALTER TYPE "EventStatus" ADD VALUE IF NOT EXISTS 'SUSPENDED';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PaymentStatus_old') THEN
    ALTER TABLE "payments"
      ALTER COLUMN "status" DROP DEFAULT,
      ALTER COLUMN "status" TYPE "PaymentStatus" USING (
        CASE "status"::text
          WHEN 'AUTHORIZED' THEN 'VERIFIED'
          WHEN 'PAID' THEN 'VERIFIED'
          WHEN 'FAILED' THEN 'REJECTED'
          WHEN 'REFUNDED' THEN 'REJECTED'
          WHEN 'CANCELLED' THEN 'REJECTED'
          ELSE "status"::text
        END
      )::"PaymentStatus",
      ALTER COLUMN "status" SET DEFAULT 'PENDING';
    DROP TYPE "PaymentStatus_old";
  END IF;
END $$;

ALTER TABLE "events"
  ADD COLUMN IF NOT EXISTS "quotedAmount" DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS "paymentInstructions" TEXT;
UPDATE "events" e
SET "quotedAmount" = p."price"
FROM "PricingTier" p
WHERE e."pricingTierId" = p."id" AND e."quotedAmount" = 0.00;
ALTER TABLE "events" ALTER COLUMN "quotedAmount" DROP DEFAULT;

ALTER TABLE "payments"
  DROP CONSTRAINT IF EXISTS "payments_providerRef_key",
  DROP COLUMN IF EXISTS "provider",
  DROP COLUMN IF EXISTS "providerRef",
  DROP COLUMN IF EXISTS "authorizedAt",
  DROP COLUMN IF EXISTS "paidAt",
  ADD COLUMN IF NOT EXISTS "paymentMethod" TEXT,
  ADD COLUMN IF NOT EXISTS "paymentReference" TEXT,
  ADD COLUMN IF NOT EXISTS "submittedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "reviewedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "reviewedById" UUID,
  ADD COLUMN IF NOT EXISTS "rejectionReason" TEXT;

CREATE INDEX IF NOT EXISTS "payments_reviewedById_idx" ON "payments"("reviewedById");
ALTER TABLE "payments"
  ADD CONSTRAINT "payments_reviewedById_fkey"
  FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
