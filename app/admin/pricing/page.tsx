"use client";

import { useEffect, useState } from "react";

interface PricingTier {
  id: string;
  minGuests: number;
  maxGuests: number;
  price: number;
  active: boolean;
}

export default function AdminPricingPage() {
  const [tiers, setTiers] = useState<PricingTier[]>([]);
  const [minGuests, setMinGuests] = useState("");
  const [maxGuests, setMaxGuests] = useState("");
  const [price, setPrice] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingMin, setEditingMin] = useState("");
  const [editingMax, setEditingMax] = useState("");
  const [editingPrice, setEditingPrice] = useState("");

  useEffect(() => {
    fetchTiers();
  }, []);

  async function fetchTiers() {
    try {
      const res = await fetch("/api/admin/pricing");
      const data = await res.json();
      if (Array.isArray(data)) setTiers(data);
    } catch {
      setError("Failed to load pricing tiers");
    }
  }

  async function handleCreateTier(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setSuccess("");
    try {
      const res = await fetch("/api/admin/pricing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ minGuests: Number(minGuests), maxGuests: Number(maxGuests), price: Number(price) }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to create tier");
        return;
      }
      setMinGuests("");
      setMaxGuests("");
      setPrice("");
      setSuccess("Pricing tier added successfully.");
      fetchTiers();
    } catch {
      setError("Unable to connect to the pricing service.");
    }
  }

  function startEditing(tier: PricingTier) {
    setEditingId(tier.id);
    setEditingMin(String(tier.minGuests));
    setEditingMax(String(tier.maxGuests));
    setEditingPrice(String(tier.price));
    setError("");
  }

  async function handleUpdateTier(id: string) {
    setError("");
    setSuccess("");
    try {
      const res = await fetch("/api/admin/pricing", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, minGuests: Number(editingMin), maxGuests: Number(editingMax), price: Number(editingPrice) }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to update tier");
        return;
      }
      setEditingId(null);
      setSuccess("Pricing tier updated successfully.");
      fetchTiers();
    } catch {
      setError("Unable to connect to the pricing service.");
    }
  }

  async function handleDeleteTier(tier: PricingTier) {
    if (!window.confirm(`Delete the ${tier.minGuests}-${tier.maxGuests} guest tier?`)) return;
    setError("");
    setSuccess("");
    try {
      const res = await fetch(`/api/admin/pricing?id=${encodeURIComponent(tier.id)}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to delete tier");
        return;
      }
      setSuccess("Pricing tier deleted successfully.");
      fetchTiers();
    } catch {
      setError("Unable to connect to the pricing service.");
    }
  }

  async function handleToggleActive(tier: PricingTier) {
    setError("");
    setSuccess("");
    try {
      const res = await fetch("/api/admin/pricing", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: tier.id,
          minGuests: tier.minGuests,
          maxGuests: tier.maxGuests,
          price: tier.price,
          active: !tier.active,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to update tier status");
        return;
      }
      setSuccess(tier.active ? "Pricing tier deactivated." : "Pricing tier activated.");
      fetchTiers();
    } catch {
      setError("Unable to connect to the pricing service.");
    }
  }

  const fieldClass = "mt-2 w-full rounded-lg border border-gray-200 bg-gray-50 px-3.5 py-3 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-100";

  return (
    <div>
      <header className="mb-6">
        <p className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-blue-600">Admin settings</p>
        <h2 className="text-2xl font-bold tracking-tight text-gray-900">Pricing manager</h2>
        <p className="mt-2 text-sm text-gray-500">Set, review, edit, or remove per-guest pricing tiers.</p>
      </header>

        {error && <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{error}</div>}
        {success && <div className="mb-6 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">{success}</div>}

        <section className="mb-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="mb-5"><h2 className="text-lg font-bold text-gray-900">Add pricing tier</h2><p className="mt-1 text-sm text-gray-500">The selected range determines the event&apos;s per-guest rate.</p></div>
          <form onSubmit={handleCreateTier} className="grid gap-4 sm:grid-cols-4 sm:items-end">
            <label className="text-sm font-semibold text-gray-700">Minimum guests<input type="number" min="1" value={minGuests} onChange={(event) => setMinGuests(event.target.value)} required className={fieldClass} /></label>
            <label className="text-sm font-semibold text-gray-700">Maximum guests<input type="number" min="1" value={maxGuests} onChange={(event) => setMaxGuests(event.target.value)} required className={fieldClass} /></label>
            <label className="text-sm font-semibold text-gray-700">TSh per guest<input type="number" min="0" step="0.01" value={price} onChange={(event) => setPrice(event.target.value)} required className={fieldClass} /></label>
            <button type="submit" className="rounded-lg bg-blue-600 px-4 py-3 text-sm font-bold text-white transition hover:bg-blue-700">Add tier</button>
          </form>
        </section>

        <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="mb-5"><h2 className="text-lg font-bold text-gray-900">Current pricing tiers</h2><p className="mt-1 text-sm text-gray-500">A tier in use by an event or payment cannot be deleted.</p></div>
          {tiers.length === 0 ? <p className="rounded-lg border border-dashed border-gray-200 bg-gray-50 p-8 text-center text-sm text-gray-500">No pricing tiers configured.</p> : <div className="space-y-3">{tiers.map((tier) => editingId === tier.id ? <div key={tier.id} className="grid gap-3 rounded-lg border border-blue-200 bg-blue-50/50 p-4 sm:grid-cols-[1fr_auto_1fr_1.2fr_auto_auto] sm:items-end"><label className="text-xs font-bold uppercase tracking-wide text-gray-500">Min<input type="number" min="1" value={editingMin} onChange={(event) => setEditingMin(event.target.value)} className={fieldClass} /></label><span className="hidden pb-3 text-gray-400 sm:block">to</span><label className="text-xs font-bold uppercase tracking-wide text-gray-500">Max<input type="number" min="1" value={editingMax} onChange={(event) => setEditingMax(event.target.value)} className={fieldClass} /></label><label className="text-xs font-bold uppercase tracking-wide text-gray-500">TSh per guest<input type="number" min="0" step="0.01" value={editingPrice} onChange={(event) => setEditingPrice(event.target.value)} className={fieldClass} /></label><button type="button" onClick={() => handleUpdateTier(tier.id)} className="rounded-lg bg-emerald-600 px-4 py-3 text-sm font-bold text-white hover:bg-emerald-700">Save</button><button type="button" onClick={() => setEditingId(null)} className="rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm font-bold text-gray-600 hover:bg-gray-50">Cancel</button></div> : <div key={tier.id} className="flex flex-col gap-3 rounded-lg border border-gray-200 bg-gray-50 px-4 py-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm font-bold text-gray-900">{tier.minGuests.toLocaleString()} - {tier.maxGuests.toLocaleString()} guests</p><p className="mt-1 text-sm text-gray-500">{tier.price.toLocaleString()} TSh per guest</p><p className={`mt-1 text-xs font-semibold uppercase tracking-wide ${tier.active ? "text-emerald-600" : "text-gray-400"}`}>{tier.active ? "Active" : "Inactive"}</p></div><div className="flex gap-2"><button type="button" onClick={() => handleToggleActive(tier)} className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 shadow-sm hover:border-emerald-300 hover:text-emerald-600">{tier.active ? "Deactivate" : "Activate"}</button><button type="button" onClick={() => startEditing(tier)} className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 shadow-sm hover:border-blue-300 hover:text-blue-600">Edit</button><button type="button" onClick={() => handleDeleteTier(tier)} className="rounded-lg border border-red-200 bg-white px-4 py-2 text-sm font-semibold text-red-600 shadow-sm hover:bg-red-50">Delete</button></div></div>)}</div>}
        </section>
    </div>
  );
}
