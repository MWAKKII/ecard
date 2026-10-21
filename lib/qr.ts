import { randomBytes } from "crypto";
import QRCode from "qrcode";

/**
 * QR ticket identity (Step 9).
 *
 * Rules from the spec:
 * - The token is cryptographically random and non-guessable.
 * - The token never contains guest personal information — the server resolves
 *   it to the guest record.
 * - Uniqueness is enforced at the database level (Guest.qrToken @unique).
 * - QR generation is idempotent: the token is issued once when the guest is
 *   created and is never silently rotated; rendering an image is a pure
 *   function of the stored token.
 */

/** 24 random bytes → 32 URL-safe characters (192 bits of entropy). */
export function generateQrToken(): string {
  return randomBytes(24).toString("base64url");
}

/** Strict format check used to validate freshly generated tokens in tests. */
const GENERATED_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32}$/;

export function isValidQrTokenFormat(token: unknown): token is string {
  return typeof token === "string" && GENERATED_TOKEN_PATTERN.test(token);
}

/** Renders the opaque token as a PNG image, server-side. */
export async function renderQrPng(token: string): Promise<Buffer> {
  if (!token || token.length > 256 || !/^[A-Za-z0-9_-]+$/.test(token)) {
    throw new Error("Refusing to render an invalid QR token.");
  }
  return QRCode.toBuffer(token, {
    type: "png",
    width: 512,
    margin: 2,
    errorCorrectionLevel: "M",
  });
}
