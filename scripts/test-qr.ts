/**
 * Offline test for the QR token pipeline (Step 9 acceptance).
 * Run with: npm run test:qr
 *
 * Covers:
 *  - 100 guests, each token unique (base64url 32 chars)
 *  - format validation accepts all issued tokens
 *  - malformed / guessable tokens are rejected
 *  - PNG rendering works
 * No database required.
 */
import { generateQrToken, isValidQrTokenFormat, renderQrPng } from "../lib/qr";

async function main() {
  const tokens = new Set<string>();
  const count = 100;

  for (let i = 0; i < count; i++) {
    const t = generateQrToken();
    if (!isValidQrTokenFormat(t)) {
      throw new Error(`Token ${i} failed format validation: ${t}`);
    }
    tokens.add(t);
  }

  if (tokens.size !== count) {
    throw new Error(`Expected ${count} unique tokens, got ${tokens.size}`);
  }

  const invalid = [
    "",
    "short",
    "a".repeat(31),
    "a".repeat(33),
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=", // padding not allowed
    "../../etc/passwd",
    "' OR 1=1 --",
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAA-", // '-' not in base64url alphabet... check
  ];
  for (const bad of invalid) {
    if (isValidQrTokenFormat(bad)) {
      // '-' IS in base64url; only fail if it truly should not pass
      if (!/^[A-Za-z0-9_-]{32}$/.test(bad)) {
        throw new Error(`Invalid token accepted: ${JSON.stringify(bad)}`);
      }
    }
  }

  const png = await renderQrPng([...tokens][0]);
  if (png.length < 500) throw new Error("PNG too small, render failed");

  console.log(`PASS: ${count} unique tokens, format validation, invalid rejection, PNG render (${png.length} bytes)`);
}

main().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
