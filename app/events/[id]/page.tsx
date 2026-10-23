"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import GuestManager from "@/components/guest-manager";

/**
 * Event workspace — the screen a client lands on after clicking an event
 * (spec section 10, "Client Dashboard"): a tabbed view with Dashboard
 * summary, Guest List, Event Details, Scan E-Card and Reports.
 * Scan and Reports arrive in spec Steps 11 and 12 — they are placeholders
 * until then.
 */

type Tab = "dashboard" | "guests" | "details" | "scan" | "reports";

interface GuestStat {
  attendances: { status: string }[];
}

interface EventInfo {
  id: string;
  title: string;
  type: string;
  coupleNames: string | null;
  description: string | null;
  location: string | null;
  startsAt: string | null;
  status: string;
  guestCount: number;
  quotedAmount: number | string;
  paymentInstructions: string | null;
  cardTemplateId: string | null;
  pricingTier: { id: string; minGuests: number; maxGuests: number; price: number } | null;
  payments: { id: string; status: string; amount: number | string; currency: string; rejectionReason: string | null }[];
}

const TABS: { key: Tab; label: string }[] = [
  { key: "dashboard", label: "Dashboard" },
  { key: "guests", label: "Guest list" },
  { key: "details", label: "Event details" },
  { key: "scan", label: "Scan E-Card" },
  { key: "reports", label: "Reports" },
];

function statusBadgeClass(status: string) {
  if (status === "AUTHORIZED") return "bg-emerald-100 text-emerald-700";
  if (status === "SUSPENDED" || status === "CANCELLED") return "bg-red-100 text-red-700";
  return "bg-amber-100 text-amber-700";
}

export default function EventWorkspacePage() {
  const params = useParams();
  const eventId = String(params.id);

  const [event, setEvent] = useState<EventInfo | null>(null);
  const [guests, setGuests] = useState<GuestStat[]>([]);
  const [tab, setTab] = useState<Tab>("dashboard");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // E-Card design assignment (spec Step 8).
  const [templates, setTemplates] = useState<{ id: string; title: string }[]>([]);
  const [templatesLoaded, setTemplatesLoaded] = useState(false);
  const [templatesError, setTemplatesError] = useState("");
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [savingDesign, setSavingDesign] = useState(false);
  const [designNotice, setDesignNotice] = useState("");
  const [designError, setDesignError] = useState("");

  const load = useCallback(async () => {
    // The two requests are independent — fire them together instead of
    // waiting for the event before asking for guests (halves load time).
    const [res, guestRes] = await Promise.all([
      fetch(`/api/events/${eventId}`, { credentials: "include" }),
      fetch(`/api/events/${eventId}/guests`, { credentials: "include" }),
    ]);
    const [data, list] = await Promise.all([
      res.json(),
      guestRes.ok ? guestRes.json() : Promise.resolve(null),
    ]);
    if (!res.ok) throw new Error(data.error || "Failed to load the event");
    setEvent(data);
    setSelectedTemplateId(data.cardTemplateId ?? "");
    if (data.status === "AUTHORIZED" && Array.isArray(list)) {
      setGuests(list);
    } else {
      setGuests([]);
    }
  }, [eventId]);

  useEffect(() => {
    if (!eventId) return;
    let cancelled = false;
    (async () => {
      try {
        await load();
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load the event");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [eventId, load]);

  // Card designs are only needed on the Event details tab — load them lazily
  // so opening the workspace costs no extra roundtrip.
  useEffect(() => {
    if (tab !== "details" || templatesLoaded) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/templates", { credentials: "include" });
        const data = await res.json().catch(() => null);
        if (cancelled) return;
        if (res.ok && Array.isArray(data)) {
          setTemplates(data);
        } else {
          setTemplatesError("Could not load card designs. Refresh the page to try again.");
        }
        setTemplatesLoaded(true);
      } catch {
        if (!cancelled) {
          setTemplatesError("Could not load card designs. Check your connection and refresh.");
          setTemplatesLoaded(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tab, templatesLoaded]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-gray-500 font-medium animate-pulse">Loading event...</p>
      </div>
    );
  }

  if (error || !event) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 gap-4">
        <p className="text-red-500 font-medium">Error: {error || "Event not found"}</p>
        <Link href="/events" className="text-blue-600 font-semibold hover:underline">&larr; Back to events</Link>
      </div>
    );
  }

  const authorized = event.status === "AUTHORIZED";
  const total = guests.length;
  const attended = guests.filter((g) => g.attendances[0]?.status === "CHECKED_IN").length;
  const notAttended = total - attended;
  const percent = total > 0 ? Math.round((attended / total) * 100) : 0;
  const capacity = event.pricingTier?.maxGuests ?? null;
  const payment = event.payments[0];

  async function saveDesign(templateId: string) {
    if (!templateId) return;
    setSavingDesign(true);
    setDesignNotice("");
    setDesignError("");
    try {
      const res = await fetch(`/api/events/${eventId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ cardTemplateId: templateId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not save the card design");
      setEvent((prev) => (prev ? { ...prev, cardTemplateId: templateId } : prev));
      setDesignNotice("Card design saved. New cards will use it.");
    } catch (err) {
      setDesignError(err instanceof Error ? err.message : "Could not save the card design");
    } finally {
      setSavingDesign(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6 md:p-10">
      <div className="max-w-6xl mx-auto">
        <div className="mb-6">
          <Link href="/events" className="text-sm font-semibold text-blue-600 hover:text-blue-700">&larr; Back to events</Link>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-bold tracking-tight text-gray-900">
              {event.title}
              {event.coupleNames && <span className="text-gray-400 font-normal"> · {event.coupleNames}</span>}
            </h1>
            <span className={`rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wider ${statusBadgeClass(event.status)}`}>
              {event.status}
            </span>
          </div>
          <p className="mt-1 text-sm text-gray-500">
            {event.startsAt
              ? new Date(event.startsAt).toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" })
              : "No date set"}
            {event.location ? ` · ${event.location}` : ""}
          </p>
        </div>

        <nav className="mb-6 flex flex-wrap gap-2 rounded-xl border border-gray-200 bg-white p-2 shadow-sm">
          {TABS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`rounded-lg px-4 py-2.5 text-sm font-semibold transition ${tab === key ? "bg-blue-600 text-white shadow-sm" : "text-gray-600 hover:bg-gray-50"}`}
            >
              {label}
            </button>
          ))}
        </nav>

        {tab === "dashboard" && (
          <div>
            {!authorized && (
              <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-5">
                <h3 className="font-bold text-amber-800">This event is {event.status.toLowerCase()}</h3>
                <p className="mt-1 text-sm text-amber-700">
                  {payment?.status === "SUBMITTED"
                    ? "Your payment is under review. The administrator will verify it and authorize the event — guest management opens then."
                    : "Submit your payment so the administrator can verify it and authorize this event. Guest management opens once it is authorized."}
                </p>
                <Link href={`/events/${event.id}/pay`} className="mt-3 inline-block rounded-lg bg-amber-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-amber-700">
                  {payment?.status === "SUBMITTED" ? "View payment status" : "Go to payment page"}
                </Link>
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {[
                { label: "Total guests", value: total, tone: "text-gray-900" },
                { label: "Attended", value: attended, tone: "text-emerald-600" },
                { label: "Not attended", value: notAttended, tone: "text-amber-600" },
                { label: "Attendance %", value: `${percent}%`, tone: "text-blue-600" },
              ].map((stat) => (
                <div key={stat.label} className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
                  <p className="text-xs font-bold uppercase tracking-wider text-gray-500">{stat.label}</p>
                  <p className={`mt-2 text-3xl font-bold ${stat.tone}`}>{authorized ? stat.value : "—"}</p>
                </div>
              ))}
            </div>

            {authorized && capacity !== null && (
              <div className="mt-6 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
                <div className="flex flex-wrap justify-between items-center gap-2 text-sm">
                  <span className="font-semibold text-gray-800">
                    Guest capacity — {event.pricingTier ? `${event.pricingTier.minGuests}-${event.pricingTier.maxGuests} guest` : ""} tier
                  </span>
                  <span className={`font-bold ${total >= capacity ? "text-red-600" : "text-blue-600"}`}>
                    {total} / {capacity} guest{capacity === 1 ? "" : "s"}
                    {event.guestCount !== capacity && ` · ${event.guestCount} expected when booked`}
                  </span>
                </div>
                <div className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-gray-100">
                  <div
                    className={`h-full rounded-full ${total >= capacity ? "bg-red-500" : "bg-blue-500"}`}
                    style={{ width: `${Math.min(100, Math.round((total / capacity) * 100))}%` }}
                  />
                </div>
                <button
                  onClick={() => setTab("guests")}
                  className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-blue-700"
                >
                  Manage guests &rarr;
                </button>
              </div>
            )}
          </div>
        )}

        {tab === "guests" && <GuestManager eventId={eventId} compact />}

        {tab === "details" && (
          <div className="grid gap-6 lg:grid-cols-2">
            <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
              <h2 className="text-lg font-bold text-gray-900">Event details</h2>
              <dl className="mt-4 space-y-3 text-sm">
                {[
                  ["Event type", event.type.charAt(0) + event.type.slice(1).toLowerCase()],
                  ["Title", event.title],
                  ["Couple names", event.coupleNames || "—"],
                  ["Date", event.startsAt ? new Date(event.startsAt).toLocaleString() : "—"],
                  ["Venue", event.location || "—"],
                  ["Description", event.description || "—"],
                ].map(([label, value]) => (
                  <div key={label} className="grid grid-cols-[130px_1fr] gap-3 border-b border-gray-100 pb-3 last:border-0">
                    <dt className="font-semibold text-gray-500">{label}</dt>
                    <dd className="text-gray-800">{String(value)}</dd>
                  </div>
                ))}
              </dl>
            </section>
            <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
              <h2 className="text-lg font-bold text-gray-900">Booking &amp; payment</h2>
              <dl className="mt-4 space-y-3 text-sm">
                {[
                  ["Pricing tier", event.pricingTier ? `${event.pricingTier.minGuests}-${event.pricingTier.maxGuests} guests` : "—"],
                  ["Expected guests", String(event.guestCount)],
                  ["Tier capacity", capacity !== null ? `${capacity} guests` : "—"],
                  ["Price per guest", event.pricingTier ? `${Number(event.pricingTier.price).toLocaleString()} TSh` : "—"],
                  ["Quoted amount", `${Number(event.quotedAmount).toLocaleString()} ${payment?.currency || "TSh"}`],
                  ["Payment status", payment?.status || "PENDING"],
                  ...(payment?.rejectionReason ? [["Rejection reason", payment.rejectionReason]] : []),
                ].map(([label, value]) => (
                  <div key={label} className="grid grid-cols-[130px_1fr] gap-3 border-b border-gray-100 pb-3 last:border-0">
                    <dt className="font-semibold text-gray-500">{label}</dt>
                    <dd className="text-gray-800">{String(value)}</dd>
                  </div>
                ))}
              </dl>
              {!authorized && (
                <Link href={`/events/${event.id}/pay`} className="mt-4 inline-block rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-blue-700">
                  Payment page &rarr;
                </Link>
              )}
            </section>

            <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm lg:col-span-2">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-bold text-gray-900">E-Card design</h2>
                  <p className="mt-1 text-sm text-gray-500">
                    The administrator&apos;s design is combined with each guest&apos;s name and personal QR code to produce a
                    downloadable PNG card.
                  </p>
                </div>
                <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
                  {selectedTemplateId
                    ? `Selected: ${templates.find((t) => t.id === selectedTemplateId)?.title ?? "Assigned design"}`
                    : "No design assigned"}
                </span>
              </div>

              {templates.length === 0 ? (
                <p className="mt-4 rounded-lg border border-dashed border-gray-200 bg-gray-50 p-6 text-center text-sm text-gray-500">
                  {templatesError ||
                    (templatesLoaded
                      ? "No card designs have been published yet. Ask the administrator to upload one in Card designs."
                      : "Loading card designs...")}
                </p>
              ) : (
                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  {templates.map((template) => {
                    const active = selectedTemplateId === template.id;
                    return (
                      <button
                        key={template.id}
                        type="button"
                        onClick={() => {
                          setSelectedTemplateId(template.id);
                          setDesignNotice("");
                          setDesignError("");
                        }}
                        className={`overflow-hidden rounded-lg border text-left transition ${
                          active
                            ? "border-blue-500 ring-2 ring-blue-100"
                            : "border-gray-200 hover:border-blue-300"
                        }`}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={`/api/templates/${template.id}/image`}
                          alt={template.title}
                          className="h-36 w-full object-cover"
                        />
                        <span className="block px-3 py-2 text-sm font-semibold text-gray-800">{template.title}</span>
                      </button>
                    );
                  })}
                </div>
              )}

              <div className="mt-4 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => saveDesign(selectedTemplateId)}
                  disabled={!selectedTemplateId || selectedTemplateId === event.cardTemplateId || savingDesign}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {savingDesign ? "Saving..." : "Save design"}
                </button>
                {designNotice && <span className="text-sm font-medium text-emerald-600">{designNotice}</span>}
                {designError && <span className="text-sm font-medium text-red-600">{designError}</span>}
              </div>
            </section>
          </div>
        )}

        {tab === "scan" && (
          <div className="rounded-xl border border-dashed border-gray-300 bg-white p-12 text-center">
            <p className="text-4xl">📷</p>
            <h2 className="mt-3 text-lg font-bold text-gray-900">Scan E-Card</h2>
            <p className="mt-1 text-sm text-gray-500">
              The camera QR scanner arrives in <span className="font-semibold">Step 11</span> of the build guide.
              Every guest&apos;s ticket QR image is already available from the Guest list tab.
            </p>
          </div>
        )}

        {tab === "reports" && (
          <div className="rounded-xl border border-dashed border-gray-300 bg-white p-12 text-center">
            <p className="text-4xl">📊</p>
            <h2 className="mt-3 text-lg font-bold text-gray-900">Post-event report</h2>
            <p className="mt-1 text-sm text-gray-500">
              The final report (totals, attendance %, card-type breakdown, PDF/CSV export) unlocks in{" "}
              <span className="font-semibold">Step 12</span>, once the event date has passed. Live numbers are on the Dashboard tab.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
