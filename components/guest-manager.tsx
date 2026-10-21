"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";

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
  plusOnes: number;
  attendances: Attendance[];
}

interface EventInfo {
  title: string;
  status: string;
  guestCount: number;
  pricingTier: { id: string; minGuests: number; maxGuests: number; price: number } | null;
}

const ATTENDANCE_OPTIONS = ["", "REGISTERED", "CHECKED_IN", "NO_SHOW", "LEFT"];

function attendanceOf(guest: Guest): string {
  return guest.attendances[0]?.status || "REGISTERED";
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
  const [phone, setPhone] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [email, setEmail] = useState("");
  const [cardType, setCardType] = useState("STANDARD");
  const [saving, setSaving] = useState(false);

  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState("");

  const loadData = useCallback(async () => {
    const eventRes = await fetch(`/api/events/${eventId}`, { credentials: "include" });
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
    const guestRes = await fetch(`/api/events/${eventId}/guests`, { credentials: "include" });
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
    return guests.filter((g) => {
      if (q && !g.fullName.toLowerCase().includes(q) && !(g.email || "").toLowerCase().includes(q) && !(g.phone || "").includes(q)) {
        return false;
      }
      if (cardFilter && g.cardType !== cardFilter) return false;
      if (attendanceFilter && attendanceOf(g) !== attendanceFilter) return false;
      return true;
    });
  }, [guests, search, cardFilter, attendanceFilter]);

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
        body: JSON.stringify({ fullName: name, phone, whatsapp, email, cardType }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to add guest");
      setNotice(`"${data.fullName}" added. Their QR ticket has been issued.`);
      setName("");
      setPhone("");
      setWhatsapp("");
      setEmail("");
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
      setImportResult(
        `Imported ${data.created} guest${data.created === 1 ? "" : "s"}` +
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
              {guests.length} guest{guests.length === 1 ? "" : "s"} on the list
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
          <CapacityMeter
            used={guests.length}
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
                  Phone
                  <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+255 712 345 678"
                    className="mt-1.5 w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-100" />
                </label>
                <label className="block text-sm font-semibold text-gray-700">
                  WhatsApp
                  <input type="tel" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} placeholder="+255 712 345 678"
                    className="mt-1.5 w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-100" />
                </label>
                <label className="block text-sm font-semibold text-gray-700">
                  Email
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                    className="mt-1.5 w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-100" />
                </label>
                <label className="block text-sm font-semibold text-gray-700">
                  Card type
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
          <div className="bg-white border rounded-xl p-4 mb-6 shadow-sm flex flex-wrap gap-3 items-center">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, email or phone..."
              className="flex-1 min-w-[220px] rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-100"
            />
            <select value={cardFilter} onChange={(e) => setCardFilter(e.target.value)}
              className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-100">
              <option value="">All card types</option>
              <option value="STANDARD">Standard</option>
              <option value="PREMIUM">Premium</option>
            </select>
            <select value={attendanceFilter} onChange={(e) => setAttendanceFilter(e.target.value)}
              className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-100">
              <option value="">All attendance</option>
              {ATTENDANCE_OPTIONS.filter(Boolean).map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
            </select>
            <button
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

          {/* Guest table */}
          <div className="bg-white border rounded-xl shadow-sm overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-xs uppercase tracking-wider text-gray-500">
                  <th className="px-4 py-3 font-semibold">Guest</th>
                  <th className="px-4 py-3 font-semibold">Phone / WhatsApp</th>
                  <th className="px-4 py-3 font-semibold">Card</th>
                  <th className="px-4 py-3 font-semibold">Card status</th>
                  <th className="px-4 py-3 font-semibold">Attendance</th>
                  <th className="px-4 py-3 font-semibold">Scan time</th>
                  <th className="px-4 py-3 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center text-gray-400">
                      {guests.length === 0 ? "No guests yet. Add a guest or import a CSV." : "No guests match your filters."}
                    </td>
                  </tr>
                ) : (
                  filtered.map((guest) => {
                    const attendance = attendanceOf(guest);
                    const scanTime = guest.attendances[0]?.checkedInAt;
                    return (
                      <tr key={guest.id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50/60">
                        <td className="px-4 py-3">
                          <div className="font-semibold text-gray-900">{guest.fullName}</div>
                          {guest.email && <div className="text-xs text-gray-500">{guest.email}</div>}
                        </td>
                        <td className="px-4 py-3 text-gray-600">
                          <div>{guest.phone || "—"}</div>
                          {guest.whatsapp && <div className="text-xs text-gray-400">WA: {guest.whatsapp}</div>}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${guest.cardType === "PREMIUM" ? "bg-purple-100 text-purple-700" : "bg-gray-100 text-gray-600"}`}>
                            {guest.cardType}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${
                            guest.cardStatus === "SENT" ? "bg-emerald-100 text-emerald-700"
                            : guest.cardStatus === "GENERATED" ? "bg-blue-100 text-blue-700"
                            : "bg-amber-100 text-amber-700"}`}>
                            {guest.cardStatus}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${
                            attendance === "CHECKED_IN" ? "bg-emerald-100 text-emerald-700"
                            : attendance === "NO_SHOW" ? "bg-red-100 text-red-700"
                            : attendance === "LEFT" ? "bg-gray-200 text-gray-600"
                            : "bg-sky-100 text-sky-700"}`}>
                            {attendance.replace("_", " ")}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-500">
                          {scanTime ? new Date(scanTime).toLocaleString() : "—"}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex justify-end gap-3 text-xs font-semibold">
                            <a
                              href={`/api/events/${eventId}/guests/${guest.id}/qr`}
                              target="_blank"
                              rel="noreferrer"
                              className="text-blue-600 hover:underline"
                            >
                              QR
                            </a>
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
    </div>
  );
}
