-- Use Tanzanian shillings for existing and future payments.
UPDATE "payments" SET "currency" = 'TSH' WHERE "currency" <> 'TSH';
ALTER TABLE "payments" ALTER COLUMN "currency" SET DEFAULT 'TSH';
