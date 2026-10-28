"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Event-day QR check-in (Step 11).
 *
 * The camera is requested only after an explicit tap so mobile browsers can
 * show a clear permission prompt. Decoding stays in the browser; the network
 * request contains only the opaque ticket token, never guest details or the
 * camera stream. The server owns all validation and the check-in timestamp.
 */

type Phase = "idle" | "starting" | "scanning" | "checking";

type ScanOutcome =
  | { kind: "success"; guestName: string; cardType: string; scannedAt: string }
  | {
      kind: "already_scanned";
      guestName: string;
      cardType: string;
      scannedAt: string | null;
    }
  | { kind: "wrong_event" }
  | { kind: "invalid_card" }
  | { kind: "camera_error"; message: string }
  | { kind: "server_error"; message: string };

interface ScanResponse {
  state?: string;
  guest?: { id?: string; fullName?: string; cardType?: string };
  scannedAt?: string | null;
  error?: string;
}

function cardTypeLabel(cardType: string): string {
  if (cardType === "PREMIUM") return "Premium card";
  if (cardType === "STANDARD") return "Standard card";
  return "E-Card";
}

function formatScanTime(iso: string | null): string {
  if (!iso) return "original scan time unavailable";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "original scan time unavailable";
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function cameraErrorMessage(error: unknown): string {
  const name = error instanceof DOMException ? error.name : "";
  switch (name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
      return "Camera permission was denied. Allow camera access in your browser settings, then try again.";
    case "NotFoundError":
    case "DevicesNotFoundError":
      return "No camera was found on this device. Use a phone or tablet with a camera.";
    case "NotReadableError":
    case "TrackStartError":
      return "The camera is already in use by another app. Close the other app and try again.";
    case "OverconstrainedError":
      return "This device's camera cannot provide the required video mode. Try another browser.";
    case "SecurityError":
      return "Camera access is blocked. Open this page over HTTPS and allow camera access.";
    default:
      return "Could not start the camera. Check your browser permissions and try again.";
  }
}

function Spinner({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent ${className}`}
    />
  );
}

function CameraIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-9 w-9"
    >
      <path d="M4 7.5A2.5 2.5 0 0 1 6.5 5h1.1l.8-1.5h7.2l.8 1.5h1.1A2.5 2.5 0 0 1 20 7.5v9a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5v-9Z" />
      <circle cx="12" cy="12" r="3.2" />
    </svg>
  );
}

function OutcomeCard({
  outcome,
  onScanNext,
}: {
  outcome: ScanOutcome;
  onScanNext: () => void;
}) {
  if (outcome.kind === "success") {
    return (
      <div
        role="status"
        aria-live="polite"
        className="rounded-xl border border-emerald-200 bg-emerald-50 p-5"
      >
        <p className="text-xs font-bold uppercase tracking-wider text-emerald-700">
          Checked in
        </p>
        <h3 className="mt-1 text-xl font-bold text-emerald-950">{outcome.guestName}</h3>
        <p className="mt-1 text-sm text-emerald-800">
          {cardTypeLabel(outcome.cardType)} · Checked in at{" "}
          <time dateTime={outcome.scannedAt}>{formatScanTime(outcome.scannedAt)}</time>
        </p>
        <p className="mt-2 text-xs text-emerald-700">
          Attendance saved with the server scan time.
        </p>
        <button
          type="button"
          onClick={onScanNext}
          className="mt-4 w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-emerald-700"
        >
          Scan next guest
        </button>
      </div>
    );
  }

  if (outcome.kind === "already_scanned") {
    return (
      <div
        role="status"
        aria-live="polite"
        className="rounded-xl border border-amber-200 bg-amber-50 p-5"
      >
        <p className="text-xs font-bold uppercase tracking-wider text-amber-700">
          Already scanned
        </p>
        <h3 className="mt-1 text-xl font-bold text-amber-950">{outcome.guestName}</h3>
        <p className="mt-1 text-sm text-amber-800">
          {cardTypeLabel(outcome.cardType)} · Original check-in:{" "}
          {outcome.scannedAt ? (
            <time dateTime={outcome.scannedAt}>{formatScanTime(outcome.scannedAt)}</time>
          ) : (
            "scan time unavailable"
          )}
        </p>
        <p className="mt-2 text-xs text-amber-700">
          This guest was not checked in again. The original scan time was kept.
        </p>
        <button
          type="button"
          onClick={onScanNext}
          className="mt-4 w-full rounded-lg bg-amber-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-amber-700"
        >
          Scan next guest
        </button>
      </div>
    );
  }

  if (outcome.kind === "wrong_event") {
    return (
      <div
        role="alert"
        className="rounded-xl border border-rose-200 bg-rose-50 p-5"
      >
        <p className="text-xs font-bold uppercase tracking-wider text-rose-700">
          Wrong event
        </p>
        <h3 className="mt-1 text-xl font-bold text-rose-950">This card belongs elsewhere</h3>
        <p className="mt-1 text-sm text-rose-800">
          The QR code is a valid ticket, but it belongs to a different event. The guest was not
          checked in.
        </p>
        <button
          type="button"
          onClick={onScanNext}
          className="mt-4 w-full rounded-lg bg-rose-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-rose-700"
        >
          Scan another card
        </button>
      </div>
    );
  }

  if (outcome.kind === "invalid_card") {
    return (
      <div
        role="alert"
        className="rounded-xl border border-rose-200 bg-rose-50 p-5"
      >
        <p className="text-xs font-bold uppercase tracking-wider text-rose-700">
          Invalid card
        </p>
        <h3 className="mt-1 text-xl font-bold text-rose-950">Ticket not recognized</h3>
        <p className="mt-1 text-sm text-rose-800">
          This is not a valid E-Card ticket for this event. Nothing was changed.
        </p>
        <button
          type="button"
          onClick={onScanNext}
          className="mt-4 w-full rounded-lg bg-rose-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-rose-700"
        >
          Scan another card
        </button>
      </div>
    );
  }

  const title = outcome.kind === "camera_error" ? "Camera unavailable" : "Scan failed";

  return (
    <div
      role="alert"
      className="rounded-xl border border-rose-200 bg-rose-50 p-5"
    >
      <p className="text-xs font-bold uppercase tracking-wider text-rose-700">{title}</p>
      <h3 className="mt-1 text-xl font-bold text-rose-950">
        {outcome.kind === "camera_error" ? "Camera could not start" : "Ticket was not checked in"}
      </h3>
      <p className="mt-1 text-sm text-rose-800">{outcome.message}</p>
      <button
        type="button"
        onClick={onScanNext}
        className="mt-4 w-full rounded-lg bg-rose-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-rose-700"
      >
        Try again
      </button>
    </div>
  );
}

export default function EventQrScanner({
  eventId,
  eventTitle,
}: {
  eventId: string;
  eventTitle: string;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const frameRef = useRef<number | null>(null);
  const mountedRef = useRef(true);
  const startingRef = useRef(false);
  const submittingRef = useRef(false);

  const [phase, setPhase] = useState<Phase>("idle");
  const [outcome, setOutcome] = useState<ScanOutcome | null>(null);

  const stopCamera = useCallback(() => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    const stream = streamRef.current;
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      stopCamera();
    };
  }, [stopCamera]);

  const submitToken = useCallback(
    async (rawToken: string) => {
      if (submittingRef.current) return;
      submittingRef.current = true;
      stopCamera();
      setPhase("checking");

      try {
        const response = await fetch(`/api/events/${eventId}/scan`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ token: rawToken.trim() }),
        });
        const data = (await response.json().catch(() => null)) as ScanResponse | null;

        if (response.ok && data?.state === "success") {
          if (!mountedRef.current) return;
          setOutcome({
            kind: "success",
            guestName: data.guest?.fullName || "Guest",
            cardType: data.guest?.cardType || "STANDARD",
            scannedAt: data.scannedAt || new Date().toISOString(),
          });
        } else if (response.ok && data?.state === "already_scanned") {
          if (!mountedRef.current) return;
          setOutcome({
            kind: "already_scanned",
            guestName: data.guest?.fullName || "Guest",
            cardType: data.guest?.cardType || "STANDARD",
            scannedAt: data.scannedAt ?? null,
          });
        } else if (data?.state === "wrong_event") {
          if (!mountedRef.current) return;
          setOutcome({ kind: "wrong_event" });
        } else if (data?.state === "invalid_card") {
          if (!mountedRef.current) return;
          setOutcome({ kind: "invalid_card" });
        } else {
          if (!mountedRef.current) return;
          setOutcome({
            kind: "server_error",
            message:
              response.status === 401
                ? "Your session has expired. Refresh the page and sign in again."
                : data?.error || "The server could not check this ticket. Try again.",
          });
        }
      } catch {
        if (!mountedRef.current) return;
        setOutcome({
          kind: "server_error",
          message: "Could not reach the server. Check your connection and try again.",
        });
      } finally {
        submittingRef.current = false;
        if (mountedRef.current) setPhase("idle");
      }
    },
    [eventId, stopCamera],
  );

  const startCamera = useCallback(async () => {
    if (startingRef.current) return;
    startingRef.current = true;
    stopCamera();
    setOutcome(null);
    setPhase("starting");

    if (!window.isSecureContext) {
      setOutcome({
        kind: "camera_error",
        message:
          "Camera scanning requires HTTPS (or localhost). Open this page over a secure connection and try again.",
      });
      setPhase("idle");
      startingRef.current = false;
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setOutcome({
        kind: "camera_error",
        message:
          "This browser does not support camera access. Try a recent version of Chrome, Safari, or Firefox.",
      });
      setPhase("idle");
      startingRef.current = false;
      return;
    }

    let stream: MediaStream | null = null;

    try {
      // Load the decoder only when the user starts scanning. jsQR runs as a
      // pure-JS decoder on the main thread, so frames are throttled below.
      const { default: jsQR } = await import("jsqr");
      if (!mountedRef.current) return;

      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });

      if (!mountedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) {
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        throw new Error("Video element is not ready");
      }

      video.srcObject = stream;
      await video.play();
      if (!mountedRef.current) return;

      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("Canvas 2D is not available");

      setPhase("scanning");

      let lastScan = 0;
      const handleFrame = (now: number) => {
        if (!streamRef.current) return;

        // Decode at about five frames per second. This is enough for a QR
        // code held in view while keeping older phones responsive.
        if (now - lastScan >= 180) {
          lastScan = now;
          const currentVideo = videoRef.current;

          if (
            currentVideo &&
            currentVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
            currentVideo.videoWidth > 0 &&
            currentVideo.videoHeight > 0
          ) {
            const width = currentVideo.videoWidth;
            const height = currentVideo.videoHeight;
            const scale = Math.min(1, 720 / Math.max(width, height));
            canvas.width = Math.max(1, Math.round(width * scale));
            canvas.height = Math.max(1, Math.round(height * scale));

            context.drawImage(currentVideo, 0, 0, canvas.width, canvas.height);
            const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
            const code = jsQR(imageData.data, imageData.width, imageData.height, {
              inversionAttempts: "dontInvert",
            });

            if (code?.data) {
              void submitToken(code.data);
              return;
            }
          }
        }

        frameRef.current = requestAnimationFrame(handleFrame);
      };

      frameRef.current = requestAnimationFrame(handleFrame);
    } catch (error) {
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }
      if (streamRef.current === stream) {
        streamRef.current = null;
      }
      if (!mountedRef.current) return;
      stopCamera();
      setOutcome({ kind: "camera_error", message: cameraErrorMessage(error) });
      setPhase("idle");
    } finally {
      startingRef.current = false;
    }
  }, [stopCamera, submitToken]);

  const stopScanning = useCallback(() => {
    stopCamera();
    setPhase("idle");
    setOutcome(null);
  }, [stopCamera]);

  const scanNext = useCallback(() => {
    void startCamera();
  }, [startCamera]);

  const cameraOff = phase === "idle" && !outcome;
  const overlayLabel =
    phase === "starting"
      ? "Requesting camera permission..."
      : phase === "checking"
        ? "Checking ticket..."
        : outcome
          ? "Camera off — see result"
          : "Camera off";

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-blue-600">
            Event check-in
          </p>
          <h2 className="mt-1 text-2xl font-bold tracking-tight text-gray-900">Scan E-Card</h2>
          <p className="mt-1 max-w-2xl text-sm text-gray-500">
            Point the camera at a guest&apos;s ticket QR code. Only the decoded ticket token is
            sent to the server for validation.
          </p>
        </div>
        <span className="max-w-full truncate rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-600">
          {eventTitle}
        </span>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="order-2 lg:order-1">
          <div className="relative aspect-[4/3] overflow-hidden rounded-xl bg-gray-950">
            <video
              ref={videoRef}
              aria-label="Camera preview for QR scanning"
              className="h-full w-full object-cover"
              autoPlay
              muted
              playsInline
            />

            {phase === "scanning" ? (
              <>
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <div className="relative aspect-square w-[62%] max-w-[270px] rounded-2xl border-2 border-emerald-400 shadow-[0_0_0_9999px_rgba(0,0,0,0.38)]">
                    <span className="absolute -left-0.5 -top-0.5 h-8 w-8 rounded-tl-xl border-l-4 border-t-4 border-emerald-300" />
                    <span className="absolute -right-0.5 -top-0.5 h-8 w-8 rounded-tr-xl border-r-4 border-t-4 border-emerald-300" />
                    <span className="absolute -bottom-0.5 -left-0.5 h-8 w-8 rounded-bl-xl border-b-4 border-l-4 border-emerald-300" />
                    <span className="absolute -bottom-0.5 -right-0.5 h-8 w-8 rounded-br-xl border-b-4 border-r-4 border-emerald-300" />
                  </div>
                </div>
                <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent p-4 pt-10 text-center">
                  <p className="text-sm font-semibold text-white">Hold the QR code inside the frame</p>
                  <p className="mt-0.5 text-xs text-white/75">Scanning automatically...</p>
                </div>
              </>
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-gray-950/85 p-6 text-center text-white">
                {phase === "starting" || phase === "checking" ? <Spinner /> : <CameraIcon />}
                <p className="text-sm font-semibold">{overlayLabel}</p>
                {cameraOff && (
                  <p className="max-w-xs text-xs text-gray-300">
                    Tap Start camera when you are ready for the first guest.
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-gray-500">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-2.5 py-1 font-medium">
              <span className={`h-2 w-2 rounded-full ${phase === "scanning" ? "bg-emerald-500" : "bg-gray-400"}`} />
              {phase === "scanning" ? "Camera live" : "Camera off"}
            </span>
            <span>Camera access requires HTTPS or localhost.</span>
          </div>
        </div>

        <div className="order-1 lg:order-2">
          {outcome ? (
            <OutcomeCard outcome={outcome} onScanNext={scanNext} />
          ) : phase === "idle" ? (
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-5">
              <h3 className="text-lg font-bold text-gray-900">Ready to check guests in</h3>
              <p className="mt-1 text-sm text-gray-600">
                Start the camera and allow permission when your browser asks. Each valid card is
                checked in once, and the server records the exact scan time.
              </p>
              <button
                type="button"
                onClick={scanNext}
                className="mt-4 w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-blue-700"
              >
                Start camera
              </button>
              <ul className="mt-4 space-y-2 text-xs text-gray-500">
                <li>• Use the rear camera on a phone for the best scan.</li>
                <li>• Hold the card steady and fill the frame with the QR code.</li>
                <li>• The camera stops after each scan so the result is clear.</li>
              </ul>
            </div>
          ) : phase === "starting" ? (
            <div className="rounded-xl border border-blue-200 bg-blue-50 p-5">
              <div className="flex items-center gap-2 text-blue-800">
                <Spinner />
                <h3 className="text-lg font-bold">Waiting for camera permission</h3>
              </div>
              <p className="mt-2 text-sm text-blue-800">
                Allow camera access in the browser prompt. If you do not see a prompt, check the
                camera icon in your browser&apos;s address bar.
              </p>
            </div>
          ) : phase === "scanning" ? (
            <div className="rounded-xl border border-blue-200 bg-blue-50 p-5">
              <h3 className="text-lg font-bold text-blue-950">Scanning for a ticket</h3>
              <p className="mt-1 text-sm text-blue-800">
                Point the rear camera at the guest&apos;s QR code. The result will appear here as
                soon as a code is detected.
              </p>
              <button
                type="button"
                onClick={stopScanning}
                className="mt-4 w-full rounded-lg border border-blue-300 bg-white px-4 py-2.5 text-sm font-bold text-blue-700 transition hover:bg-blue-100"
              >
                Stop camera
              </button>
            </div>
          ) : (
            <div className="rounded-xl border border-blue-200 bg-blue-50 p-5">
              <div className="flex items-center gap-2 text-blue-800">
                <Spinner />
                <h3 className="text-lg font-bold">Checking ticket...</h3>
              </div>
              <p className="mt-2 text-sm text-blue-800">
                The server is verifying the card and recording attendance. Keep this page open.
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
