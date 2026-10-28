"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import GuestCardDialog from "@/components/guest-card-dialog";
import {
  DELIVERY_STATUS_BADGE,
  DELIVERY_STATUS_LABEL,
  type DeliveryStatusValue,
} from "@/lib/delivery-status";

/**
 * Guest management UI (spec Step 8 / Client Dashboard "Guest List" tab).
 * Used by the old /events/[id]/guests page and by the event workspace
 * (/events/[id]) as its Guests tab.
 *
 * Capacity rule: the event's pricing tier is the hard limit — the 1-100
 * tier allows 100 guests, 101-200 allows 200, and so on. The server
 * enforces the same rule; this component surfaces it as a meter and
 * disables adding/importing once the tier is full.
 */

interface Attendance {
  id: string;
  status: string;
  checkedInAt?: string | null;
}

interface Guest {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
  cardType: "STANDARD" | "PREMIUM";
  cardStatus: "PENDING" | "GENERATED" | "SENT";
  deliveryStatus: DeliveryStatusValue;
  deliveredAt: string | null;
  deliveryProvider: string | null;
  deliveryError: string | null;
  plusOnes: number;
  attendances: Attendance[];
}

interface EventInfo {
  title: string;
  status: string;
  guestCount: number;
  cardTemplateId: string | null;
  pricingTier: { id: string; minGuests: number; maxGuests: number; price: number } | null;
}

const ATTENDANCE_LABELS: Record<string, string> = {
  REGISTERED: "Registered",
  CHECKED_IN: "Checked in",
  NO_SHOW: "No show",
  LEFT: "Left",
};

const ATTENDANCE_FILTERS = ["REGISTERED", "CHECKED_IN", "NO_SHOW", "LEFT"];

function attendanceOf(guest: Guest): string {
  return guest.attendances[0]?.status || "REGISTERED";
}

function attendanceLabel(status: string): string {
  return (
    ATTENDANCE_LABELS[status] ??
    status
      .replace(/_/g, " ")
      .toLowerCase()
      .replace(/\b\w/g, (character) => character.toUpperCase())
  );
}

function attendanceBadgeClass(status: string): string {
  if (status === "CHECKED_IN") return "bg-emerald-100 text-emerald-700";
  if (status === "NO_SHOW") return "bg-red-100 text-red-700";
  if (status === "LEFT") return "bg-gray-200 text-gray-600";
  return "bg-sky-100 text-sky-700";
}

function cardTypeLabel(cardType: Guest["cardType"]): string {
  return cardType === "PREMIUM" ? "Premium" : "Standard";
}

function cardGeneratedState(guest: Guest, hasTemplate: boolean) {
  if (guest.cardStatus === "PENDING") {
    return {
      label: "Pending",
      className: "bg-amber-100 text-amber-700",
      title: hasTemplate
        ? "The personalized card has not been generated yet. Open Card to retry."
        : "Choose an E-Card design in the Event details tab to generate this card.",
    };
  }

  return {
    label: "Generated",
    className: "bg-blue-100 text-blue-700",
    title: "The personalized card is generated and ready to preview, download, or send.",
  };
}

function TotalCard({ label, value, tone }: { label: string; value: string | number; tone: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <p className="text-[11px] font-bold uppercase tracking-wider text-gray-500">{label}</p>
      <p className={`mt-1.5 text-2xl font-bold ${tone}`}>{value}</p>
    </div>
  );
}

function CapacityMeter({ used, capacity, tierName }: { used: number; capacity: number | null; tierName: string | null }) {
  if (capacity === null) return null;
  const percent = Math.min(100, Math.round((used / capacity) * 100));
  const full = used >= capacity;
  const warn = !full && percent >= 80;
  return (
    <div className="bg-white border rounded-xl p-4 mb-6 shadow-sm">
      <div className="flex flex-wrap justify-between items-center gap-2 text-sm">
        <span className="font-semibold text-gray-800">
          Guest capacity{tierName ? ` — ${tierName} tier` : ""}
        </span>
        <span className={`font-bold ${full ? "text-red-600" : warn ? "text-amber-600" : "text-blue-600"}`}>
          {used} / {capacity} guest{capacity === 1 ? "" : "s"}{full ? " — capacity reached" : ` · ${capacity - used} slot${capacity - used === 1 ? "" : "s"} left`}
        </span>
      </div>
      <div className="mt-2 h-2.5 w-full rounded-full bg-gray-100 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${full ? "bg-red-500" : warn ? "bg-amber-500" : "bg-blue-500"}`}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

export default function GuestManager({ eventId, compact = false }: { eventId: string; compact?: boolean }) {
  const [guests, setGuests] = useState<Guest[]>([]);
  const [event, setEvent] = useState<EventInfo | null>(null);
  const [gate, setGate] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [search, setSearch] = useState("");
  const [cardFilter, setCardFilter] = useState("");
  const [attendanceFilter, setAttendanceFilter] = useState("");

  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [cardType, setCardType] = useState("STANDARD");
  const [saving, setSaving] = useState(false);

  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState("");

  // Personalized card dialog (Step 8).
  const [cardGuest, setCardGuest] = useState<Guest | null>(null);

  const loadData = useCallback(async () => {
    // Fire both requests together — they are independent, and the guests
    // endpoint is already gated server-side (401/403/404).
    const [eventRes, guestRes] = await Promise.all([
      fetch(`/api/events/${eventId}`, { credentials: "include" }),
      fetch(`/api/events/${eventId}/guests`, { credentials: "include" }),
    ]);
    if (!eventRes.ok) {
      const data = await eventRes.json().catch(() => ({}));
      throw new Error(data.error || "Failed to load the event");
    }
    const ev: EventInfo = await eventRes.json();
    if (ev.status !== "AUTHORIZED") {
      setEvent(ev);
      setGuests([]);
      setGate(
        `This event is ${ev.status.toLowerCase()}. The guest list opens once the payment is verified and the administrator authorizes the event.`,
      );
      return;
    }
    setGate(null);
    if (!guestRes.ok) {
      const data = await guestRes.json().catch(() => ({}));
      throw new Error(data.error || "Failed to load guests");
    }
    const list = await guestRes.json();
    setEvent(ev);
    setGuests(Array.isArray(list) ? list : []);
  }, [eventId]);

  useEffect(() => {
    if (!eventId) return;
    let cancelled = false;
    (async () => {
      try {
        await loadData();
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load guests");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [eventId, loadData]);

  const capacity = event?.pricingTier?.maxGuests ?? null;
  const full = capacity !== null && guests.length >= capacity;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const phoneQuery = /^[\d\s+()-]+$/.test(q) ? q.replace(/\D/g, "") : "";
    return guests.filter((g) => {
      if (q) {
        const textValues = [g.fullName, g.email, g.phone, g.whatsapp].filter(Boolean) as string[];
        const textMatch = textValues.some((value) => value.toLowerCase().includes(q));
        const phoneMatch =
          phoneQuery.length > 0 &&
          [g.phone, g.whatsapp].some((value) =>
            (value || "").replace(/\D/g, "").includes(phoneQuery),
          );
        if (!textMatch && !phoneMatch) return false;
      }
      if (cardFilter && g.cardType !== cardFilter) return false;
      if (attendanceFilter && attendanceOf(g) !== attendanceFilter) return false;
      return true;
    });
  }, [guests, search, cardFilter, attendanceFilter]);

  const totals = useMemo(() => {
    const total = guests.length;
    const attended = guests.filter((guest) => attendanceOf(guest) === "CHECKED_IN").length;
    return {
      total,
      attended,
      notAttended: total - attended,
      percent: total > 0 ? Math.round((attended / total) * 100) : 0,
    };
  }, [guests]);

  const filtersActive = Boolean(search.trim() || cardFilter || attendanceFilter);

  function clearFilters() {
    setSearch("");
    setCardFilter("");
    setAttendanceFilter("");
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch(`/api/events/${eventId}/guests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ fullName: name, whatsapp, cardType }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to add guest");
      if (data.cardGenerated === true || data.cardStatus === "GENERATED") {
        setNotice(`"${data.fullName}" added — their personalized card is ready.`);
      } else if (!event?.cardTemplateId) {
        setNotice(
          `"${data.fullName}" added. Their QR ticket has been issued; choose an E-Card design to generate their card.`,
        );
      } else {
        setNotice(
          `"${data.fullName}" added, but the card could not be prepared yet — open Card to retry.`,
        );
      }
      setName("");
      setWhatsapp("");
      setCardType("STANDARD");
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add guest");
    } finally {
      setSaving(false);
    }
  }

  async function handleImport(file: File) {
    setImporting(true);
    setError("");
    setImportResult("");
    try {
      const text = await file.text();
      const res = await fetch(`/api/events/${eventId}/guests/import`, {
        method: "POST",
        headers: { "Content-Type": "text/csv" },
        credentials: "include",
        body: text,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Import failed");
      const skipped = Array.isArray(data.skipped) ? data.skipped : [];
      const cards = Number(data.cardsGenerated) || 0;
      setImportResult(
        `Imported ${data.created} guest${data.created === 1 ? "" : "s"}` +
          (cards > 0
            ? ` — ${cards} personalized card${cards === 1 ? "" : "s"} ready`
            : event?.cardTemplateId
              ? " — cards will be prepared when opened"
              : " — choose an E-Card design to generate cards") +
          (skipped.length ? `, skipped ${skipped.length}: ${skipped[0].reason}` : ""),
      );
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setImporting(false);
    }
  }

  async function handleDelete(guest: Guest) {
    if (!window.confirm(`Remove "${guest.fullName}" from the guest list?`)) return;
    setError("");
    setNotice("");
    try {
      const res = await fetch(`/api/events/${eventId}/guests/${guest.id}`, {
        method: "DELETE",
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to delete guest");
      setNotice(`"${guest.fullName}" removed.`);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete guest");
    }
  }

  if (loading) {
    return (
      <div className="py-16 text-center">
        <p className="text-gray-500 font-medium animate-pulse">Loading guests...</p>
      </div>
    );
  }

  return (
    <div>
      {!compact && (
        <div className="flex flex-wrap justify-between items-center gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-gray-900">Guests</h1>
            <p className="text-sm text-gray-500 mt-1">
              {event?.title ? `${event.title} — ` : ""}
              {totals.total} guest{totals.total === 1 ? "" : "s"} on the list
            </p>
          </div>
          <div className="flex gap-3">
            <Link href="/events" className="px-4 py-2 bg-white border border-gray-200 text-gray-700 rounded-lg font-medium shadow hover:bg-gray-50 transition">
              &larr; Events
            </Link>
            <Link href={`/events/${eventId}`} className="px-4 py-2 bg-white border border-gray-200 text-gray-700 rounded-lg font-medium shadow hover:bg-gray-50 transition">
              View event
            </Link>
          </div>
        </div>
      )}

      {error && <div className="bg-red-50 border border-red-200 text-red-600 p-4 rounded-xl mb-4 text-sm">{error}</div>}
      {notice && <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 p-4 rounded-xl mb-4 text-sm">{notice}</div>}
      {importResult && <div className="bg-blue-50 border border-blue-200 text-blue-700 p-4 rounded-xl mb-4 text-sm">{importResult}</div>}

      {gate ? (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 mb-6">
          <h3 className="font-bold text-amber-800">Guest management is locked</h3>
          <p className="text-sm text-amber-700 mt-1">{gate}</p>
          <Link href={`/events/${eventId}/pay`} className="inline-block mt-3 px-4 py-2 bg-amber-600 text-white rounded-lg text-sm font-semibold hover:bg-amber-700 transition">
            Go to payment page
          </Link>
        </div>
      ) : (
        <>
          <section className="mb-6" aria-labelledby="guest-list-totals">
            <div className="mb-3">
              <h2 id="guest-list-totals" className="text-lg font-bold text-gray-900">
                Event totals
              </h2>
              <p className="text-xs text-gray-500">
                Whole guest list — the filters below do not change these totals.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <TotalCard label="Total guests" value={totals.total} tone="text-gray-900" />
              <TotalCard label="Attended" value={totals.attended} tone="text-emerald-600" />
              <TotalCard label="Not attended" value={totals.notAttended} tone="text-amber-600" />
              <TotalCard label="Attendance %" value={`${totals.percent}%`} tone="text-blue-600" />
            </div>
          </section>

          <CapacityMeter
            used={totals.total}
            capacity={capacity}
            tierName={event?.pricingTier ? `${event.pricingTier.minGuests}-${event.pricingTier.maxGuests}` : null}
          />

          {full ? (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6 text-sm text-red-700">
              <span className="font-bold">Tier capacity reached.</span> This event&apos;s plan allows up to {capacity} guests.
              Remove a guest to free a slot, or ask the administrator to move the event to a larger tier.
            </div>
          ) : (
            showForm && (
              <form onSubmit={handleAdd} className="bg-white border rounded-xl p-6 mb-6 shadow-sm grid grid-cols-1 md:grid-cols-2 gap-4">
                <label className="block text-sm font-semibold text-gray-700 md:col-span-2">
                  Full name *
                  <input type="text" value={name} onChange={(e) => setName(e.target.value)} required maxLength={120}
                    className="mt-1.5 w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-100" />
                </label>
                <label className="block text-sm font-semibold text-gray-700">
                  WhatsApp number
                  <input type="tel" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} placeholder="+255 712 345 678"
                    className="mt-1.5 w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-100" />
                </label>
                <label className="block text-sm font-semibold text-gray-700">
                  Card quality
                  <select value={cardType} onChange={(e) => setCardType(e.target.value)}
                    className="mt-1.5 w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-100">
                    <option value="STANDARD">Standard</option>
                    <option value="PREMIUM">Premium</option>
                  </select>
                </label>
                <div className="md:col-span-2">
                  <button type="submit" disabled={saving}
                    className="px-6 py-2.5 bg-blue-600 text-white rounded-lg font-semibold text-sm hover:bg-blue-700 transition disabled:opacity-50">
                    {saving ? "Adding..." : "Add Guest"}
                  </button>
                </div>
              </form>
            )
          )}

          {/* Search, filters, CSV import */}
          <div className="bg-white border rounded-xl p-4 mb-3 shadow-sm flex flex-wrap gap-3 items-center">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, email, phone or WhatsApp..."
              aria-label="Search guests"
              className="flex-1 min-w-[220px] rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-100"
            />
            <select
              value={cardFilter}
              onChange={(e) => setCardFilter(e.target.value)}
              aria-label="Filter by card type"
              className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-100"
            >
              <option value="">All card types</option>
              <option value="STANDARD">Standard</option>
              <option value="PREMIUM">Premium</option>
            </select>
            <select
              value={attendanceFilter}
              onChange={(e) => setAttendanceFilter(e.target.value)}
              aria-label="Filter by attendance"
              className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-100"
            >
              <option value="">All attendance</option>
              {ATTENDANCE_FILTERS.map((status) => (
                <option key={status} value={status}>
                  {attendanceLabel(status)}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setShowForm((v) => !v)}
              disabled={full}
              title={full ? "Tier capacity reached" : undefined}
              className="px-4 py-2.5 rounded-lg text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {showForm ? "Close form" : "+ Add guest"}
            </button>
            <label className={`px-4 py-2.5 rounded-lg text-sm font-semibold transition ${importing || full ? "opacity-50 cursor-not-allowed" : "bg-white border border-blue-200 text-blue-600 hover:bg-blue-50 cursor-pointer"}`} title={full ? "Tier capacity reached" : undefined}>
              {importing ? "Importing..." : "Import CSV"}
              <input
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                disabled={importing || full}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleImport(file);
                  e.target.value = "";
                }}
              />
            </label>
          </div>

          <div className="mb-6 flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500">
            <span>
              Showing <span className="font-semibold text-gray-700">{filtered.length}</span> of{" "}
              <span className="font-semibold text-gray-700">{totals.total}</span>{" "}
              guest{totals.total === 1 ? "" : "s"}
            </span>
            {filtersActive && (
              <button
                type="button"
                onClick={clearFilters}
                className="font-semibold text-blue-600 hover:underline"
              >
                Clear search &amp; filters
              </button>
            )}
          </div>

          {event && !event.cardTemplateId && (
            <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-medium text-amber-800">
              Choose an E-Card design in the <span className="font-bold">Event details</span> tab to enable personalized
              card generation for guests.
            </p>
          )}

          {/* Guest table */}
          <div className="bg-white border rounded-xl shadow-sm overflow-x-auto">
            <table className="w-full min-w-[1050px] text-left text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-xs uppercase tracking-wider text-gray-500">
                  <th scope="col" className="px-4 py-3 font-semibold">Guest name</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Phone</th>
                  <th scope="col" className="px-4 py-3 font-semibold">WhatsApp</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Card type</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Card generated</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Attendance status</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Scan time</th>
                  <th scope="col" className="px-4 py-3 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-10 text-center text-gray-400">
                      {guests.length === 0 ? (
                        "No guests yet. Add a guest or import a CSV."
                      ) : (
                        <div className="flex flex-col items-center gap-2">
                          <span>No guests match your filters.</span>
                          <button
                            type="button"
                            onClick={clearFilters}
                            className="font-semibold text-blue-600 hover:underline"
                          >
                            Clear search &amp; filters
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ) : (
                  filtered.map((guest) => {
                    const attendance = attendanceOf(guest);
                    const scanTime = guest.attendances[0]?.checkedInAt;
                    const cardState = cardGeneratedState(guest, Boolean(event?.cardTemplateId));
                    return (
                      <tr key={guest.id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50/60">
                        <td className="px-4 py-3">
                          <div className="font-semibold text-gray-900">{guest.fullName}</div>
                          {guest.email && <div className="text-xs text-gray-500">{guest.email}</div>}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-gray-600">
                          {guest.phone || "—"}
                        </td>
                        <td className="px-4 py-3 text-gray-600">
                          <div className="whitespace-nowrap">{guest.whatsapp || "—"}</div>
                          {!guest.whatsapp && guest.phone && (
                            <div className="text-[11px] text-gray-400">Uses phone number</div>
                          )}
                          <div className="mt-1 flex flex-wrap items-center gap-1">
                            <span
                              title={guest.deliveryError || "WhatsApp delivery status"}
                              className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${DELIVERY_STATUS_BADGE[guest.deliveryStatus]}`}
                            >
                              {DELIVERY_STATUS_LABEL[guest.deliveryStatus]}
                            </span>
                            {guest.deliveryStatus === "SENT" && guest.deliveredAt && (
                              <span className="text-[11px] text-gray-400">
                                {new Date(guest.deliveredAt).toLocaleString()}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`rounded-full px-2.5 py-1 text-xs font-bold ${
                              guest.cardType === "PREMIUM"
                                ? "bg-purple-100 text-purple-700"
                                : "bg-gray-100 text-gray-600"
                            }`}
                          >
                            {cardTypeLabel(guest.cardType)}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span
                            title={cardState.title}
                            className={`rounded-full px-2.5 py-1 text-xs font-bold ${cardState.className}`}
                          >
                            {cardState.label}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`rounded-full px-2.5 py-1 text-xs font-bold ${attendanceBadgeClass(attendance)}`}
                          >
                            {attendanceLabel(attendance)}
                          </span>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-xs text-gray-500">
                          {scanTime ? new Date(scanTime).toLocaleString() : "—"}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex justify-end gap-3 whitespace-nowrap text-xs font-semibold">
                            <a
                              href={`/api/events/${eventId}/guests/${guest.id}/qr`}
                              target="_blank"
                              rel="noreferrer"
                              className="text-blue-600 hover:underline"
                            >
                              QR
                            </a>
                            <button
                              onClick={() => setCardGuest(guest)}
                              disabled={!event?.cardTemplateId}
                              title={
                                event?.cardTemplateId
                                  ? "Preview, download or send this guest's personalized card"
                                  : "Choose an E-Card design in the Event details tab first"
                              }
                              className="text-emerald-600 hover:underline disabled:cursor-not-allowed disabled:text-gray-300 disabled:no-underline"
                            >
                              Card
                            </button>
                            <button onClick={() => handleDelete(guest)} className="text-red-500 hover:underline">
                              Remove
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <p className="text-xs text-gray-400 mt-4">
            CSV format: <code className="bg-gray-100 px-1 rounded">fullName,phone,whatsapp,email,cardType</code> — one header row required.
          </p>
        </>
      )}

      {cardGuest && event && (
        <GuestCardDialog
          eventId={eventId}
          guest={cardGuest}
          eventTitle={event.title}
          templateTitle={null}
          onClose={() => setCardGuest(null)}
          onDeliveryChange={(delivery) => {
            setGuests((prev) =>
              prev.map((guest) => (guest.id === cardGuest.id ? { ...guest, ...delivery } : guest)),
            );
            setCardGuest((prev) =>
              prev && prev.id === cardGuest.id ? { ...prev, ...delivery } : prev,
            );
          }}
        />
      )}
    </div>
  );
}
