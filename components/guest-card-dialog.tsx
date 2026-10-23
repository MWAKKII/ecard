"use client";

import { useState } from "react";

/**
 * Personalized card delivery dialog (spec Step 8).
 *
 * Shows the server-rendered PNG (template + guest name + opaque QR) and offers
 * the two delivery paths the spec asks for: download, or send through
 * WhatsApp. Browsers that support the Web Share API share the actual PNG file
 * straight into WhatsApp; everywhere else the card is downloaded and a
 * WhatsApp chat is opened so the organizer can attach it.
 */

interface CardGuest {
  id: string;
  fullName: string;
  phone: string | null;
  whatsapp: string | null;
}

export default function GuestCardDialog({
  eventId,
  guest,
  eventTitle,
  templateTitle,
  onClose,
  onSent,
}: {
  eventId: string;
  guest: CardGuest;
  eventTitle: string;
  templateTitle: string | null;
  onClose: () => void;
  onSent: () => void;
}) {
  const [sharing, setSharing] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);

  const cardUrl = `/api/events/${eventId}/guests/${guest.id}/card`;
  const downloadUrl = `${cardUrl}?download=1`;
  const fileName = `card-${guest.fullName.replace(/[^\w]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase() || "guest"}.png`;
  const shareText = `Hi ${guest.fullName}, here is your card for ${eventTitle}.`;

  async function markSent() {
    try {
      await fetch(`/api/events/${eventId}/guests/${guest.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ cardStatus: "SENT" }),
      });
      onSent();
    } catch {
      /* the card itself is already delivered; status is best-effort */
    }
  }

  async function sendWhatsApp() {
    setSharing(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch(cardUrl, { credentials: "include" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Could not generate the card");
      }

      const blob = await res.blob();
      const file = new File([blob], fileName, { type: "image/png" });
      const nav = navigator as Navigator & { canShare?: (data?: ShareData) => boolean };

      if (typeof nav.share === "function" && nav.canShare?.({ files: [file] })) {
        await nav.share({ files: [file], text: shareText });
        setNotice("Card shared. Marked as sent.");
        await markSent();
      } else {
        // No file sharing in this browser: download the PNG, then open the
        // guest's WhatsApp chat with a ready-made message.
        const objectUrl = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = objectUrl;
        link.download = fileName;
        link.click();
        URL.revokeObjectURL(objectUrl);

        const digits = (guest.whatsapp || guest.phone || "").replace(/\D/g, "");
        const chat = digits ? `https://wa.me/${digits}` : "https://wa.me/";
        window.open(`${chat}?text=${encodeURIComponent(`${shareText} Attach the downloaded card image.`)}`, "_blank", "noopener,noreferrer");
        setNotice("Card downloaded — attach it to the WhatsApp chat that just opened. Marked as sent.");
        await markSent();
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return; // user cancelled the share sheet
      setError(err instanceof Error ? err.message : "Could not send the card");
    } finally {
      setSharing(false);
    }
  }

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
            {templateTitle && <p className="mt-0.5 text-xs text-gray-400">Design: {templateTitle}</p>}
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
              disabled={sharing || !loaded}
              className="rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {sharing ? "Preparing..." : "Send through WhatsApp"}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-gray-200 px-4 py-2.5 text-sm font-semibold text-gray-600 transition hover:bg-gray-50"
            >
              Close
            </button>
          </div>

          {notice && <p className="rounded-lg bg-emerald-50 p-3 text-xs font-medium text-emerald-700">{notice}</p>}
          {error && <p className="rounded-lg bg-red-50 p-3 text-xs font-medium text-red-700">{error}</p>}
        </div>
      </div>
    </div>
  );
}
