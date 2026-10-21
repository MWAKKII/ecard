"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

interface PricingTier {
  id: string;
  minGuests: number;
  maxGuests: number;
  price: number;
  active: boolean;
}

const EVENT_TYPES = [
  { value: "WEDDING", label: "Wedding" },
  { value: "CORPORATE", label: "Corporate" },
  { value: "OTHER", label: "Other" },
];

export default function CreateEventPage() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [eventType, setEventType] = useState("WEDDING");
  const [coupleNames, setCoupleNames] = useState("");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [location, setLocation] = useState("");
  const [guestCount, setGuestCount] = useState("");
  const [pricingTiers, setPricingTiers] = useState<PricingTier[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    async function fetchFormOptions() {
      try {
        // Public endpoint: only active tiers are exposed to clients.
        const pricingRes = await fetch("/api/pricing");
        const pricingData = await pricingRes.json();
        if (pricingRes.ok && Array.isArray(pricingData)) setPricingTiers(pricingData);
      } catch (err) {
        console.error("Failed to load event options", err);
      }
    }
    fetchFormOptions();
  }, []);

  const expectedGuests = Number(guestCount);
  const selectedPricingTier = pricingTiers.find(
    (tier) => tier.active && expectedGuests >= tier.minGuests && expectedGuests <= tier.maxGuests,
  );

  const handleCreateEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title || !Number.isInteger(expectedGuests) || expectedGuests < 1) {
      setError("Please provide an event title and a valid expected guest count.");
      return;
    }
    if (!date) {
      setError("Please provide the event date.");
      return;
    }
    if (eventType === "WEDDING" && !coupleNames.trim()) {
      setError("Please provide the couple names for this wedding.");
      return;
    }

    try {
      setSubmitting(true);
      setError("");
      const res = await fetch("/api/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          type: eventType,
          coupleNames: eventType === "WEDDING" ? coupleNames : "",
          description,
          date,
          time,
          location,
          guestCount: expectedGuests,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create event");

      router.push("/events");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create event");
      setSubmitting(false);
    }
  };

  const inputClass =
    "w-full px-4 py-3 bg-slate-100/70 border border-slate-200/80 rounded-2xl text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition-all shadow-inner";
  const labelClass = "block mb-2 text-xs font-bold tracking-wider text-slate-500 uppercase";

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans p-6 md:p-12 transition-all duration-300">
      <div className="max-w-2xl mx-auto">

        {/* Header */}
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">
            Create New Event ✨
          </h1>
          <Link href="/events" className="text-sm font-semibold text-blue-600 hover:text-blue-700 transition-colors">
            &larr; Back to Events
          </Link>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-600 p-4 rounded-2xl mb-6 text-sm shadow-sm animate-in fade-in">
            {error}
          </div>
        )}

        {/* iOS Glassmorphism Container */}
        <div className="backdrop-blur-2xl bg-white/78 border border-white/80 p-8 rounded-3xl shadow-[0_20px_40px_rgba(0,0,0,0.06)] transition-all duration-300">
          <form onSubmit={handleCreateEvent} className="space-y-6">

            <div>
              <label className={labelClass}>
                Event Type *
              </label>
              <select
                value={eventType}
                onChange={(e) => setEventType(e.target.value)}
                required
                className={inputClass}
              >
                {EVENT_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className={labelClass}>
                Event Title *
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                placeholder="e.g. Royal Gala 2026"
                className={inputClass}
              />
            </div>

            {eventType === "WEDDING" && (
              <div>
                <label className={labelClass}>
                  Couple Names *
                </label>
                <input
                  type="text"
                  value={coupleNames}
                  onChange={(e) => setCoupleNames(e.target.value)}
                  required={eventType === "WEDDING"}
                  placeholder="e.g. Amina & Juma"
                  className={inputClass}
                />
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={labelClass}>
                  Event Date *
                </label>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  required
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>
                  Start Time
                </label>
                <input
                  type="time"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  className={inputClass}
                />
              </div>
            </div>

            <div>
              <label className={labelClass}>
                Venue / Location
              </label>
              <input
                type="text"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="e.g. Serena Hotel, Dar es Salaam"
                className={inputClass}
              />
            </div>

            <div>
              <label className={labelClass}>
                Number of Guests Expected *
              </label>
              <input
                type="number"
                min="1"
                step="1"
                value={guestCount}
                onChange={(e) => setGuestCount(e.target.value)}
                required
                placeholder="e.g. 100"
                className={inputClass}
              />
              {guestCount && (
                <p className={`mt-2 text-xs ${selectedPricingTier ? "text-emerald-600" : "text-rose-600"}`}>
                  {selectedPricingTier
                    ? `Pricing: ${selectedPricingTier.price.toLocaleString()} TSh per guest (${selectedPricingTier.minGuests}-${selectedPricingTier.maxGuests} guests)`
                    : "No active pricing range covers this guest count."}
                </p>
              )}
            </div>

            <div>
              <label className={labelClass}>
                Description
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                placeholder="Brief event details..."
                className={`${inputClass} resize-none`}
              />
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-4 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-2xl text-sm shadow-xl shadow-blue-600/20 transition-all duration-300 transform hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-50 mt-4"
            >
              {submitting ? "Creating Event..." : "Create Event 🚀"}
            </button>
          </form>
        </div>

      </div>
    </div>
  );
}
