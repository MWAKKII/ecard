import { randomUUID } from "node:crypto";

/**
 * Private object storage for uploaded card designs.
 *
 * Supabase Storage is used through its REST API so the app does not need a
 * client bundle or an extra dependency. Only server-side code may call these
 * helpers: the service-role/secret key bypasses Storage row-level security and
 * must never be exposed to the browser.
 *
 * Existing `data:image/...;base64,...` values continue to work. New uploads use
 * `supabase://<bucket>/<object-path>` references when object storage is
 * configured.
 */

const DATA_URL_RE =
  /^data:(image\/(?:png|jpeg|webp|gif|avif));base64,([A-Za-z0-9+/]+={0,2})$/;

const STORAGE_REF_PREFIX = "supabase://";
const STORAGE_REQUEST_TIMEOUT_MS = 30_000;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

const CONTENT_TYPE_BY_EXTENSION: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
};

const EXTENSION_BY_CONTENT_TYPE: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
};

export interface ObjectStorageConfig {
  baseUrl: string;
  bucket: string;
  serviceKey: string;
}

export interface LoadedImage {
  bytes: Buffer;
  contentType: string;
}

export class ObjectStorageNotConfiguredError extends Error {
  constructor(
    message = "Object storage is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
  ) {
    super(message);
    this.name = "ObjectStorageNotConfiguredError";
  }
}

export class ObjectStorageError extends Error {
  status: number;

  constructor(message: string, status = 502) {
    super(message);
    this.name = "ObjectStorageError";
    this.status = status;
  }
}

function serviceKey(): string | undefined {
  return process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || undefined;
}

/**
 * True when at least one storage setting is present. A partially configured
 * storage setup is still treated as "configured" so production fails closed
 * instead of silently falling back to embedding images in Postgres.
 */
export function hasObjectStorageConfig(): boolean {
  return Boolean(process.env.SUPABASE_URL?.trim() || serviceKey());
}

/**
 * Returns validated storage settings, or null when storage is not configured.
 * Throws when settings are partial or invalid.
 */
export function getObjectStorageConfig(): ObjectStorageConfig | null {
  const rawUrl = process.env.SUPABASE_URL?.trim();
  const key = serviceKey();
  const bucket = process.env.SUPABASE_STORAGE_BUCKET?.trim() || "ecard-assets";

  if (!rawUrl && !key) return null;
  if (!rawUrl || !key) {
    throw new ObjectStorageNotConfiguredError(
      "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set when object storage is used.",
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new ObjectStorageNotConfiguredError("SUPABASE_URL is not a valid URL.");
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw new ObjectStorageNotConfiguredError(
      "SUPABASE_URL must be an https:// project URL without credentials.",
    );
  }
  if (!/^[a-z0-9][a-z0-9._-]{0,62}$/i.test(bucket)) {
    throw new ObjectStorageNotConfiguredError(
      "SUPABASE_STORAGE_BUCKET must contain only letters, numbers, dots, underscores or hyphens.",
    );
  }

  return {
    baseUrl: rawUrl.replace(/\/+$/, ""),
    bucket,
    serviceKey: key,
  };
}

export function requireObjectStorage(): ObjectStorageConfig {
  const config = getObjectStorageConfig();
  if (!config) throw new ObjectStorageNotConfiguredError();
  return config;
}

export function isObjectStorageConfigured(): boolean {
  try {
    return getObjectStorageConfig() !== null;
  } catch {
    return false;
  }
}

/** Creates a collision-resistant, extension-preserving object key. */
export function createTemplateObjectKey(contentType: string): string {
  const extension = EXTENSION_BY_CONTENT_TYPE[contentType] ?? "bin";
  const date = new Date().toISOString().slice(0, 10);
  return `templates/${date}/${randomUUID()}.${extension}`;
}

function storageRef(bucket: string, objectPath: string): string {
  return `${STORAGE_REF_PREFIX}${bucket}/${objectPath}`;
}

function parseStorageRef(ref: string): { bucket: string; objectPath: string } | null {
  if (!ref.startsWith(STORAGE_REF_PREFIX)) return null;

  let parsed: URL;
  try {
    parsed = new URL(ref);
  } catch {
    throw new ObjectStorageError("The stored image reference is invalid.", 500);
  }

  const bucket = parsed.hostname;
  const segments = parsed.pathname.split("/").filter(Boolean);
  if (!bucket || segments.length === 0 || parsed.search || parsed.hash) {
    throw new ObjectStorageError("The stored image reference is invalid.", 500);
  }

  const decoded = segments.map((segment) => {
    let value: string;
    try {
      value = decodeURIComponent(segment);
    } catch {
      throw new ObjectStorageError("The stored image reference is invalid.", 500);
    }
    if (
      !value ||
      value === "." ||
      value === ".." ||
      value.includes("/") ||
      value.includes("\\") ||
      /[\u0000-\u001f\u007f]/.test(value)
    ) {
      throw new ObjectStorageError("The stored image reference is invalid.", 500);
    }
    return value;
  });

  return { bucket, objectPath: decoded.join("/") };
}

function objectUrl(config: ObjectStorageConfig, objectPath: string): string {
  const encodedPath = objectPath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `${config.baseUrl}/storage/v1/object/${encodeURIComponent(config.bucket)}/${encodedPath}`;
}

async function storageFetch(
  config: ObjectStorageConfig,
  objectPath: string,
  init: RequestInit,
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("apikey", config.serviceKey);
  headers.set("Authorization", `Bearer ${config.serviceKey}`);

  return fetch(objectUrl(config, objectPath), {
    ...init,
    headers,
    signal: AbortSignal.timeout(STORAGE_REQUEST_TIMEOUT_MS),
  });
}

async function storageError(response: Response, action: string): Promise<ObjectStorageError> {
  let detail = "";
  try {
    detail = (await response.text()).trim().slice(0, 300);
  } catch {
    // The HTTP status is enough if the response body cannot be read.
  }
  return new ObjectStorageError(
    `Supabase Storage ${action} failed (HTTP ${response.status})${detail ? `: ${detail}` : ""}.`,
    response.status >= 500 ? 502 : response.status,
  );
}

/**
 * Uploads an image and returns the opaque reference stored in
 * `CardTemplate.imageUrl`.
 */
export async function uploadImageObject(
  objectPath: string,
  bytes: Buffer,
  contentType: string,
): Promise<string> {
  const config = requireObjectStorage();
  if (!objectPath || objectPath.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new ObjectStorageError("The object path is invalid.", 500);
  }

  const response = await storageFetch(config, objectPath, {
    method: "POST",
    headers: {
      "Content-Type": contentType,
      "cache-control": "private, max-age=3600",
      "x-upsert": "false",
    },
    body: new Uint8Array(bytes),
  });

  if (!response.ok) throw await storageError(response, "upload");
  return storageRef(config.bucket, objectPath);
}

/** Downloads an image object from Supabase Storage. */
async function downloadImageObject(ref: string): Promise<LoadedImage> {
  const config = requireObjectStorage();
  const parsed = parseStorageRef(ref);
  if (!parsed) throw new ObjectStorageError("The image source is not an object reference.", 500);
  if (parsed.bucket !== config.bucket) {
    throw new ObjectStorageError(
      "The stored image belongs to a different storage bucket. Check SUPABASE_STORAGE_BUCKET.",
      500,
    );
  }

  const response = await storageFetch(config, parsed.objectPath, {
    method: "GET",
    headers: { Accept: "image/*" },
  });
  if (!response.ok) throw await storageError(response, "download");

  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_IMAGE_BYTES) {
    throw new ObjectStorageError("The stored image is too large.", 413);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_IMAGE_BYTES) {
    throw new ObjectStorageError("The stored image is too large.", 413);
  }

  const extension = parsed.objectPath.split(".").pop()?.toLowerCase() ?? "";
  return {
    bytes,
    contentType: CONTENT_TYPE_BY_EXTENSION[extension] ?? "application/octet-stream",
  };
}

function decodeDataUrl(source: string): LoadedImage | null {
  const match = DATA_URL_RE.exec(source);
  if (!match) return null;
  const bytes = Buffer.from(match[2], "base64");
  if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) {
    throw new ObjectStorageError("The stored image is empty or too large.", 500);
  }
  return { bytes, contentType: match[1] };
}

/** Loads either an existing data URL or a Supabase Storage reference. */
export async function loadImageSource(source: string): Promise<LoadedImage> {
  const dataUrl = decodeDataUrl(source);
  if (dataUrl) return dataUrl;
  if (source.startsWith(STORAGE_REF_PREFIX)) return downloadImageObject(source);
  throw new ObjectStorageError("The stored image reference is not supported.", 500);
}

/** Converts any stored image source to the data URL expected by Sharp/OCR. */
export async function loadImageDataUrl(source: string): Promise<string> {
  const image = await loadImageSource(source);
  return `data:${image.contentType};base64,${image.bytes.toString("base64")}`;
}

/** Best-effort deletion; data URLs and unconfigured storage are no-ops. */
export async function deleteImageObject(source: string): Promise<void> {
  if (!source.startsWith(STORAGE_REF_PREFIX)) return;
  const config = requireObjectStorage();
  const parsed = parseStorageRef(source);
  if (!parsed) return;
  if (parsed.bucket !== config.bucket) {
    throw new ObjectStorageError("The stored image belongs to a different bucket.", 500);
  }

  const response = await storageFetch(config, parsed.objectPath, { method: "DELETE" });
  if (!response.ok && response.status !== 404) {
    throw await storageError(response, "delete");
  }
}
