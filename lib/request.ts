import { NextResponse } from "next/server";

/**
 * Bounded request-body readers.
 *
 * Route handlers in this version of Next.js do not impose a body-size limit by
 * default. Reading `request.json()` directly therefore lets an unauthenticated
 * caller allocate arbitrarily large strings. These helpers reject oversized
 * bodies before parsing and also enforce the limit while streaming.
 */

const DEFAULT_MAX_JSON_BYTES = 1 * 1024 * 1024;

type ReadTextResult =
  | { ok: true; text: string }
  | { ok: false; response: NextResponse };

function tooLargeResponse(): NextResponse {
  return NextResponse.json({ error: "Request body is too large." }, { status: 413 });
}

function invalidBodyResponse(message = "Unable to read request body."): NextResponse {
  return NextResponse.json({ error: message }, { status: 400 });
}

export async function readTextBody(
  request: Request,
  maxBytes: number,
): Promise<ReadTextResult> {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength);
    if (!Number.isFinite(parsedLength) || parsedLength < 0) {
      return { ok: false, response: invalidBodyResponse() };
    }
    if (parsedLength > maxBytes) {
      return { ok: false, response: tooLargeResponse() };
    }
  }

  if (!request.body) {
    return { ok: false, response: invalidBodyResponse("Request body is required.") };
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, response: tooLargeResponse() };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, response: invalidBodyResponse() };
  }

  try {
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return { ok: true, text: new TextDecoder("utf-8", { fatal: true }).decode(bytes) };
  } catch {
    return { ok: false, response: invalidBodyResponse() };
  }
}

type ReadJsonResult =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; response: NextResponse };

export async function readJsonBody(
  request: Request,
  maxBytes = DEFAULT_MAX_JSON_BYTES,
): Promise<ReadJsonResult> {
  const textResult = await readTextBody(request, maxBytes);
  if (!textResult.ok) return textResult;

  let parsed: unknown;
  try {
    parsed = JSON.parse(textResult.text);
  } catch {
    return { ok: false, response: invalidBodyResponse("Invalid JSON body.") };
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ok: false, response: invalidBodyResponse("JSON body must be an object.") };
  }

  return { ok: true, body: parsed as Record<string, unknown> };
}
