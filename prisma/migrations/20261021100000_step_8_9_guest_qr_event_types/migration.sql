-- Steps 8 & 9: guest QR tokens, guest card state, event types.
--
-- Renames and additions were hand-written (the auto-generated diff was
-- incorrect: it altered guests.cardStatus before adding that column, created
-- an index that already exists from init, and offered no backfill path for
-- NOT NULL qrToken).

-- ---------------------------------------------------------------------------
-- 1) The old "CardStatus" enum describes the card *template* lifecycle
--    (DRAFT/ACTIVE/ARCHIVED). Renaming it in place keeps card_templates.status
--    and all of its data intact while freeing the name for the guest-card enum.
-- ---------------------------------------------------------------------------
ALTER TYPE "CardStatus" RENAME TO "TemplateStatus";

CREATE TYPE "EventType" AS ENUM ('WEDDING', 'CORPORATE', 'OTHER');
CREATE TYPE "CardType" AS ENUM ('STANDARD', 'PREMIUM');
CREATE TYPE "CardStatus" AS ENUM ('PENDING', 'GENERATED', 'SENT');

-- ---------------------------------------------------------------------------
-- 2) events: event type + couple names (Step 6 / spec wedding section).
-- ---------------------------------------------------------------------------
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "type" "EventType" NOT NULL DEFAULT 'OTHER';
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "coupleNames" TEXT;

-- ---------------------------------------------------------------------------
-- 3) guests: inviteToken -> qrToken (Step 9).
--    Existing rows get freshly generated opaque tokens (md5 of random data =
--    32 hex chars, PII-free). No legacy inviteToken value is carried over:
--    no application code ever read or wrote that column.
-- ---------------------------------------------------------------------------
ALTER TABLE "guests" DROP COLUMN IF EXISTS "inviteToken"; -- drops guests_inviteToken_key with it

ALTER TABLE "guests" ADD COLUMN IF NOT EXISTS "qrToken" TEXT;
UPDATE "guests"
SET "qrToken" = md5(random()::text || gen_random_uuid()::text)
WHERE "qrToken" IS NULL;
ALTER TABLE "guests" ALTER COLUMN "qrToken" SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "guests_qrToken_key" ON "guests"("qrToken");

-- ---------------------------------------------------------------------------
-- 4) guests: WhatsApp channel, card type/state, optional email (Step 8).
-- ---------------------------------------------------------------------------
ALTER TABLE "guests" ADD COLUMN IF NOT EXISTS "whatsapp" TEXT;
ALTER TABLE "guests" ADD COLUMN IF NOT EXISTS "cardType" "CardType" NOT NULL DEFAULT 'STANDARD';
ALTER TABLE "guests" ADD COLUMN IF NOT EXISTS "cardStatus" "CardStatus" NOT NULL DEFAULT 'PENDING';
ALTER TABLE "guests" ALTER COLUMN "email" DROP NOT NULL;

-- card_templates_status_idx already exists from the init migration; the
-- renamed enum keeps that index valid as-is.
