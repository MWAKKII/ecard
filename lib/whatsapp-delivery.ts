/**
 * WhatsApp card-delivery service.
 *
 * This module is the only place that talks to a WhatsApp provider. API routes
 * persist exactly what this service reports: a delivery is marked SENT only
 * after the provider returns a message id. When credentials are missing the
 * service reports NOT_CONFIGURED; it never pretends a message was sent.
 *
 * The current provider implementation is Meta's WhatsApp Cloud API. Adding
 * another provider only requires another implementation behind the same
 * sendWhatsAppCard() contract.
 */

export type WhatsAppProviderName = "meta-cloud";
export type WhatsAppMessageMode = "template" | "image";
export type WhatsAppTemplateBodyField = "guestName" | "eventTitle";

export interface WhatsAppDeliveryConfig {
  configured: boolean;
  provider: WhatsAppProviderName | null;
  mode: WhatsAppMessageMode | null;
  /** Environment variable names that are missing (never secret values). */
  missing: string[];
}

interface InternalConfig {
  configured: boolean;
  provider: WhatsAppProviderName | null;
  mode: WhatsAppMessageMode | null;
  missing: string[];
  accessToken: string;
  phoneNumberId: string;
  apiVersion: string;
  templateName: string | null;
  templateLanguage: string;
  templateBodyFields: WhatsAppTemplateBodyField[];
  configurationError: string | null;
}

export const WHATSAPP_NOT_CONFIGURED_MESSAGE =
  "WhatsApp delivery is not configured for this deployment. Download the PNG to send the card manually.";

const PROVIDER: WhatsAppProviderName = "meta-cloud";
const DEFAULT_API_VERSION = "v23.0";
const DEFAULT_TEMPLATE_LANGUAGE = "en_US";
const DEFAULT_TEMPLATE_BODY_FIELDS = "guestName,eventTitle";
const TEMPLATE_BODY_FIELDS = new Set<WhatsAppTemplateBodyField>(["guestName", "eventTitle"]);
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_CAPTION_LENGTH = 1024;
const REQUEST_TIMEOUT_MS = 30_000;

function parseTemplateBodyFields(raw: string): {
  fields: WhatsAppTemplateBodyField[];
  error: string | null;
} {
  const value = raw.trim();
  if (!value || value.toLowerCase() === "none") return { fields: [], error: null };

  const fields: WhatsAppTemplateBodyField[] = [];
  for (const item of value.split(",")) {
    const field = item.trim();
    if (!field) continue;
    if (!TEMPLATE_BODY_FIELDS.has(field as WhatsAppTemplateBodyField)) {
      return {
        fields: [],
        error: `WHATSAPP_TEMPLATE_BODY_FIELDS contains "${field}"; use guestName, eventTitle, or none.`,
      };
    }
    fields.push(field as WhatsAppTemplateBodyField);
  }
  return { fields, error: null };
}

function readConfig(): InternalConfig {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN?.trim() ?? "";
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim() ?? "";
  const apiVersion = process.env.WHATSAPP_API_VERSION?.trim() || DEFAULT_API_VERSION;
  const templateName = process.env.WHATSAPP_TEMPLATE_NAME?.trim() || null;
  const templateLanguage =
    process.env.WHATSAPP_TEMPLATE_LANGUAGE?.trim() || DEFAULT_TEMPLATE_LANGUAGE;
  const parsedBodyFields = parseTemplateBodyFields(
    process.env.WHATSAPP_TEMPLATE_BODY_FIELDS?.trim() || DEFAULT_TEMPLATE_BODY_FIELDS,
  );

  const missing: string[] = [];
  if (!accessToken) missing.push("WHATSAPP_ACCESS_TOKEN");
  if (!phoneNumberId) missing.push("WHATSAPP_PHONE_NUMBER_ID");

  const mode: WhatsAppMessageMode | null =
    missing.length === 0 ? (templateName ? "template" : "image") : null;
  const configurationError = mode === "template" ? parsedBodyFields.error : null;
  const configured = missing.length === 0 && !configurationError;

  return {
    configured,
    provider: configured ? PROVIDER : null,
    mode: configured ? mode : null,
    missing,
    accessToken,
    phoneNumberId,
    apiVersion,
    templateName,
    templateLanguage,
    templateBodyFields: parsedBodyFields.fields,
    configurationError,
  };
}

/** Public, safe-to-serialize provider state (no credentials). */
export function getWhatsAppDeliveryConfig(): WhatsAppDeliveryConfig {
  const { configured, provider, mode, missing } = readConfig();
  return { configured, provider, mode, missing };
}

export interface SendWhatsAppCardInput {
  /** Recipient in international format; non-digits are stripped. */
  to: string;
  png: Uint8Array;
  fileName: string;
  caption: string;
  guestName: string;
  eventTitle: string;
}

export type WhatsAppDeliveryErrorCode =
  | "NOT_CONFIGURED"
  | "INVALID_RECIPIENT"
  | "CARD_TOO_LARGE"
  | "PROVIDER_ERROR";

export type SendWhatsAppCardResult =
  | { ok: true; provider: WhatsAppProviderName; messageId: string }
  | {
      ok: false;
      code: WhatsAppDeliveryErrorCode;
      message: string;
      provider: WhatsAppProviderName | null;
    };

interface ProviderCardMessage {
  config: InternalConfig;
  to: string;
  png: Uint8Array;
  fileName: string;
  caption: string;
  guestName: string;
  eventTitle: string;
}

interface WhatsAppProvider {
  readonly name: WhatsAppProviderName;
  sendCard(input: ProviderCardMessage): Promise<{ messageId: string }>;
}

function truncate(value: string, max = 400): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function providerErrorMessage(payload: unknown, fallback: string): string {
  if (payload && typeof payload === "object" && "error" in payload) {
    const error = (payload as { error?: { message?: unknown } }).error;
    if (error && typeof error.message === "string" && error.message.trim()) {
      return truncate(error.message.trim());
    }
  }
  return fallback;
}

async function readJson(response: Response): Promise<unknown> {
  return response.json().catch(() => null);
}

const metaCloudProvider: WhatsAppProvider = {
  name: PROVIDER,

  async sendCard({ config, to, png, fileName, caption, guestName, eventTitle }) {
    const base = `https://graph.facebook.com/${encodeURIComponent(config.apiVersion)}/${encodeURIComponent(config.phoneNumberId)}`;

    // 1. Upload the PNG as WhatsApp media. The provider returns an id that the
    //    message references; the image bytes themselves are not sent inline.
    const form = new FormData();
    form.append("messaging_product", "whatsapp");
    form.append("file", new Blob([new Uint8Array(png)], { type: "image/png" }), fileName);

    const mediaResponse = await fetch(`${base}/media`, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.accessToken}` },
      body: form,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const mediaPayload = await readJson(mediaResponse);
    if (!mediaResponse.ok) {
      throw new Error(
        providerErrorMessage(mediaPayload, `WhatsApp media upload failed (${mediaResponse.status}).`),
      );
    }
    const mediaId =
      mediaPayload && typeof mediaPayload === "object" && "id" in mediaPayload
        ? (mediaPayload as { id?: unknown }).id
        : null;
    if (typeof mediaId !== "string" || !mediaId) {
      throw new Error("WhatsApp media upload did not return a media id.");
    }

    // 2. Send the card. Template mode is required for business-initiated
    //    messages: the approved template has an image header and a body such
    //    as "Hi {{1}}, here is your card for {{2}}." Free-form image mode is
    //    kept for recipients with an open 24-hour service window/testing.
    const bodyParameters = config.templateBodyFields.map((field) => ({
      type: "text" as const,
      text: truncate(field === "guestName" ? guestName : eventTitle, MAX_CAPTION_LENGTH),
    }));
    const message =
      config.mode === "template" && config.templateName
        ? {
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to,
            type: "template",
            template: {
              name: config.templateName,
              language: { code: config.templateLanguage },
              components: [
                {
                  type: "header",
                  parameters: [{ type: "image", image: { id: mediaId } }],
                },
                ...(bodyParameters.length > 0
                  ? [{ type: "body", parameters: bodyParameters }]
                  : []),
              ],
            },
          }
        : {
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to,
            type: "image",
            image: {
              id: mediaId,
              caption: truncate(caption, MAX_CAPTION_LENGTH),
            },
          };

    const messageResponse = await fetch(`${base}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(message),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const messagePayload = await readJson(messageResponse);
    if (!messageResponse.ok) {
      throw new Error(
        providerErrorMessage(messagePayload, `WhatsApp send failed (${messageResponse.status}).`),
      );
    }

    const messages =
      messagePayload && typeof messagePayload === "object" && "messages" in messagePayload
        ? (messagePayload as { messages?: Array<{ id?: unknown }> }).messages
        : null;
    const messageId = messages?.[0]?.id;
    if (typeof messageId !== "string" || !messageId) {
      throw new Error("WhatsApp did not return a message id; delivery cannot be confirmed.");
    }

    return { messageId };
  },
};

/**
 * Send one personalized card through the configured WhatsApp provider.
 *
 * IMPORTANT: callers may persist SENT only when this returns `{ ok: true }`.
 * Missing configuration and provider failures are returned as explicit errors.
 */
export async function sendWhatsAppCard(
  input: SendWhatsAppCardInput,
): Promise<SendWhatsAppCardResult> {
  const config = readConfig();
  if (!config.configured) {
    return {
      ok: false,
      code: "NOT_CONFIGURED",
      message: WHATSAPP_NOT_CONFIGURED_MESSAGE,
      provider: null,
    };
  }

  const to = input.to.replace(/\D/g, "");
  if (to.length < 7 || to.length > 15) {
    return {
      ok: false,
      code: "INVALID_RECIPIENT",
      message: "The guest's WhatsApp number is not valid for delivery.",
      provider: config.provider,
    };
  }

  if (input.png.byteLength === 0) {
    return {
      ok: false,
      code: "PROVIDER_ERROR",
      message: "The card image is empty; nothing was sent.",
      provider: config.provider,
    };
  }

  if (input.png.byteLength > MAX_IMAGE_BYTES) {
    return {
      ok: false,
      code: "CARD_TOO_LARGE",
      message: "The card PNG is larger than WhatsApp's 5 MB image limit.",
      provider: config.provider,
    };
  }

  try {
    const { messageId } = await metaCloudProvider.sendCard({
      config,
      to,
      png: input.png,
      fileName: input.fileName,
      caption: truncate(input.caption, MAX_CAPTION_LENGTH),
      guestName: input.guestName,
      eventTitle: input.eventTitle,
    });
    return { ok: true, provider: metaCloudProvider.name, messageId };
  } catch (error) {
    const message =
      error instanceof Error && error.message
        ? truncate(error.message)
        : "The WhatsApp provider rejected the card.";
    console.error("[whatsapp] card delivery failed:", message);
    return {
      ok: false,
      code: "PROVIDER_ERROR",
      message,
      provider: config.provider,
    };
  }
}
