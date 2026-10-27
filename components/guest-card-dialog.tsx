"use client";

import { useEffect, useState } from "react";
import {
  DELIVERY_STATUS_BADGE,
  DELIVERY_STATUS_LABEL,
  type DeliveryStatusValue,
} from "@/lib/delivery-status";

/**
 * Personalized card delivery dialog.
 *
 * Preview and PNG download are always available to the event owner. WhatsApp
 * delivery is a server action: the browser never marks a card as sent on its
 * own, and the button is disabled when the deployment has no provider
 * credentials configured. A separate manual WhatsApp action opens the guest
 * chat and downloads the PNG; it never changes delivery state.
 */

interface DeliveryState {
  deliveryStatus: DeliveryStatusValue;
  deliveredAt: string | null;
  deliveryError: string | null;
}

interface CardGuest extends DeliveryState {
  id: string;
  fullName: string;
  phone: string | null;
  whatsapp: string | null;
  cardType: "STANDARD" | "PREMIUM";
}

interface WhatsAppConfig {
  configured: boolean;
  provider: string | null;
  mode: "template" | "image" | null;
}

export default function GuestCardDialog({
  eventId,
  guest,
  eventTitle,
  templateTitle,
  onClose,
  onDeliveryChange,
}: {
  eventId: string;
  guest: CardGuest;
  eventTitle: string;
  templateTitle: string | null;
  onClose: () => void;
  onDeliveryChange: (delivery: DeliveryState) => void;
}) {
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState("");
  const [manualNotice, setManualNotice] = useState("");
  const [error, setError] = useState("");
  const [configError, setConfigError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [config, setConfig] = useState<WhatsAppConfig | null>(null);
  const [delivery, setDelivery] = useState<DeliveryState>({
    deliveryStatus: guest.deliveryStatus,
    deliveredAt: guest.deliveredAt,
    deliveryError: guest.deliveryError,
  });

  const cardUrl = `/api/events/${eventId}/guests/${guest.id}/card`;
  const downloadUrl = `${cardUrl}?download=1`;
  const deliveryUrl = `/api/events/${eventId}/guests/${guest.id}/delivery`;
  const recipient = (guest.whatsapp || guest.phone || "").replace(/\D/g, "");
  const hasValidRecipient = recipient.length >= 7 && recipient.length <= 15;
  const canSend = config?.configured === true && hasValidRecipient && !sending;
  const canSendManually = hasValidRecipient && !sending;

  // WhatsApp availability is a deployment concern, not a guest concern. Check
  // it before offering a send action so the UI never implies delivery works
  // when no provider is configured.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch(deliveryUrl, { credentials: "include", cache: "no-store" });
        const data = await res.json().catch(() => ({}));
        if (!active) return;
        if (!res.ok) {
          setConfigError(data.error || "Could not check WhatsApp delivery configuration.");
          return;
        }
        setConfig({
          configured: data.whatsapp?.configured === true,
          provider: data.whatsapp?.provider ?? null,
          mode: data.whatsapp?.mode ?? null,
        });
        if (data.delivery) {
          setDelivery({
            deliveryStatus: data.delivery.status,
            deliveredAt: data.delivery.deliveredAt ?? null,
            deliveryError: data.delivery.error ?? null,
          });
        }
      } catch {
        if (active) setConfigError("Could not check WhatsApp delivery configuration.");
      }
    })();
    return () => {
      active = false;
    };
  }, [deliveryUrl]);

  async function sendWhatsApp() {
    if (!canSend) return;
    setSending(true);
    setError("");
    setConfigError("");
    setNotice("");
    setManualNotice("");
    try {
      const res = await fetch(deliveryUrl, {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json().catch(() => ({}));

      if (data.whatsapp) {
        setConfig({
          configured: data.whatsapp.configured === true,
          provider: data.whatsapp.provider ?? null,
          mode: data.whatsapp.mode ?? null,
        });
      }

      // Only a server-confirmed SENT counts. Never infer success from an HTTP
      // 200 alone — a missing status is treated as a failed delivery.
      const serverStatus: DeliveryStatusValue | undefined =
        data.delivery?.status ?? data.deliveryStatus;
      const next: DeliveryState = {
        deliveryStatus: serverStatus ?? "FAILED",
        deliveredAt: data.delivery?.deliveredAt ?? data.deliveredAt ?? null,
        deliveryError:
          data.delivery?.error ??
          (serverStatus === "SENT" ? null : data.error || "The provider did not confirm delivery."),
      };
      setDelivery(next);
      onDeliveryChange(next);

      if (!res.ok || serverStatus !== "SENT") {
        throw new Error(data.error || "The provider did not confirm delivery.");
      }

      setNotice("Card sent through WhatsApp.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "The card could not be delivered.");
    } finally {
      setSending(false);
    }
  }

  /**
   * Manual WhatsApp fallback. Opens the guest's chat and downloads the card so
   * the organizer can attach it. This is deliberately not a delivery action:
   * it never changes delivery status, because WhatsApp cannot confirm that the
   * organizer actually sent the file.
   */
  function sendManually() {
    if (!canSendManually) return;
    setError("");
    setConfigError("");
    setNotice("");
    setManualNotice("");

    const waUrl = `https://wa.me/${recipient}?text=${encodeURIComponent(
      `Hi ${guest.fullName}, here is your e-card for ${eventTitle}.`,
    )}`;
    const opened = window.open(waUrl, "_blank");
    if (opened) opened.opener = null;

    // Trigger the same authenticated PNG download as the Download button.
    const link = document.createElement("a");
    link.href = downloadUrl;
    document.body.appendChild(link);
    link.click();
    link.remove();

    setManualNotice(
      opened
        ? "WhatsApp opened in a new tab. Attach the downloaded card from your Downloads folder, then send it. Delivery status is unchanged."
        : "The card was downloaded, but the browser blocked the WhatsApp tab. Open WhatsApp, choose this guest, and attach the downloaded card. Delivery status is unchanged.",
    );
  }

  // When the provider is missing and no send has been attempted yet, the
  // truthful state to show is "not configured", not "sent" or "not sent".
  const shownStatus: DeliveryStatusValue =
    config?.configured === false && delivery.deliveryStatus === "NOT_SENT"
      ? "NOT_CONFIGURED"
      : delivery.deliveryStatus;

  const sendLabel = sending
    ? "Sending..."
    : config === null
      ? configError
        ? "WhatsApp unavailable"
        : "Checking WhatsApp..."
      : config.configured !== true
        ? "WhatsApp not configured"
        : !recipient
          ? "No WhatsApp number"
          : "Send via WhatsApp";
  const manualSendLabel = !recipient
    ? "No WhatsApp number"
    : !hasValidRecipient
      ? "Invalid WhatsApp number"
      : "Send manually via WhatsApp";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Card for ${guest.fullName}`}
      onClick={onClose}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl md:flex-row"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex min-h-0 flex-1 items-center justify-center bg-gray-100 p-4">
          {!loaded && <p className="text-sm text-gray-500">Rendering card...</p>}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={cardUrl}
            alt={`Personalized card for ${guest.fullName}`}
            onLoad={() => setLoaded(true)}
            onError={() => {
              setLoaded(true);
              setError("Could not render this card. Check that the event has an active design.");
            }}
            className={`max-h-[70vh] w-auto rounded-lg shadow-md ${loaded ? "block" : "hidden"}`}
          />
        </div>

        <div className="flex w-full shrink-0 flex-col gap-4 overflow-y-auto p-6 md:w-80">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-blue-600">Personalized e-card</p>
            <h2 className="mt-1 text-xl font-bold text-gray-900">{guest.fullName}</h2>
            <p className="mt-1 text-sm text-gray-500">{eventTitle}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-bold ${
                  guest.cardType === "PREMIUM"
                    ? "bg-purple-100 text-purple-700"
                    : "bg-gray-100 text-gray-600"
                }`}
              >
                {guest.cardType === "PREMIUM" ? "Premium" : "Standard"} card
              </span>
              {templateTitle && <span className="text-xs text-gray-400">Design: {templateTitle}</span>}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-gray-500">
              <span className="font-semibold">Delivery</span>
              <span className={`rounded-full px-2.5 py-1 font-bold ${DELIVERY_STATUS_BADGE[shownStatus]}`}>
                {DELIVERY_STATUS_LABEL[shownStatus]}
              </span>
              {delivery.deliveredAt && shownStatus === "SENT" && (
                <span>{new Date(delivery.deliveredAt).toLocaleString()}</span>
              )}
            </div>
          </div>

          <p className="text-sm text-gray-600">
            The PNG contains the guest&apos;s name and a personal QR code with an opaque token — no personal data is stored in
            the code.
          </p>

          <div className="flex flex-col gap-2">
            <a
              href={downloadUrl}
              className="rounded-lg bg-blue-600 px-4 py-2.5 text-center text-sm font-bold text-white transition hover:bg-blue-700"
            >
              Download PNG
            </a>
            <button
              type="button"
              onClick={sendWhatsApp}
              disabled={!canSend}
              className="rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-gray-300"
            >
              {sendLabel}
            </button>
            <div className="border-t border-gray-100 pt-2">
              <button
                type="button"
                onClick={sendManually}
                disabled={!canSendManually}
                className="w-full rounded-lg border border-emerald-600 px-4 py-2.5 text-sm font-bold text-emerald-700 transition hover:bg-emerald-50 disabled:cursor-not-allowed disabled:border-gray-200 disabled:text-gray-400"
              >
                {manualSendLabel}
              </button>
              {hasValidRecipient && (
                <p className="mt-1.5 text-center text-[11px] leading-4 text-gray-500">
                  Downloads the PNG and opens the guest&apos;s chat. Does not change delivery status.
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-gray-200 px-4 py-2.5 text-sm font-semibold text-gray-600 transition hover:bg-gray-50"
            >
              Close
            </button>
          </div>

          {config?.configured === false && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs font-medium text-amber-800">
              <span className="font-bold">WhatsApp delivery is not configured.</span> No message was sent. Download the
              PNG or use <span className="font-bold">Send manually via WhatsApp</span>.
            </p>
          )}
          {config?.configured === true && config.mode === "image" && (
            <p className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs font-medium text-blue-800">
              Free-form WhatsApp mode is active. Meta only delivers these messages inside an open 24-hour
              customer-service window. An approved image template is recommended for normal guest-card delivery.
            </p>
          )}
          {config?.configured === true && !recipient && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs font-medium text-amber-800">
              This guest has no WhatsApp number, so the card cannot be sent through the provider.
            </p>
          )}
          {config?.configured === true && delivery.deliveryStatus === "NOT_CONFIGURED" && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs font-medium text-amber-800">
              The previous attempt was blocked because WhatsApp delivery was not configured. It can be retried now.
            </p>
          )}
          {configError && (
            <p className="rounded-lg bg-amber-50 p-3 text-xs font-medium text-amber-700">{configError}</p>
          )}

          {notice && (
            <p className="rounded-lg bg-emerald-50 p-3 text-xs font-medium text-emerald-700" aria-live="polite">
              {notice}
            </p>
          )}
          {manualNotice && (
            <p
              className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs font-medium text-blue-800"
              aria-live="polite"
            >
              {manualNotice}
            </p>
          )}
          {error && (
            <div className="rounded-lg bg-red-50 p-3 text-xs font-medium text-red-700" aria-live="polite">
              <p>{error}</p>
              {delivery.deliveryStatus === "FAILED" && (
                <p className="mt-1.5">
                  The card is still available. Use{" "}
                  <span className="font-bold">Send manually via WhatsApp</span> or download the PNG.
                </p>
              )}
            </div>
          )}
          {!error && delivery.deliveryStatus === "FAILED" && delivery.deliveryError && (
            <div className="rounded-lg bg-red-50 p-3 text-xs font-medium text-red-700">
              <p>Last delivery attempt: {delivery.deliveryError}</p>
              <p className="mt-1.5">
                The card is still available. Use{" "}
                <span className="font-bold">Send manually via WhatsApp</span> or download the PNG.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
