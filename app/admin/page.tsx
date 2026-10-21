"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface Template {
  id: string;
  title: string;
  description?: string;
  imageUrl: string;
  price: number;
}

interface Payment {
  id: string;
  amount: number | string;
  status: string;
  user?: { name?: string; email?: string };
  event?: { title?: string; status?: string };
}

type AdminTab = "designs" | "payments";

export default function AdminDashboard() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<AdminTab>("designs");
  const [templates, setTemplates] = useState<Template[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [designTitle, setDesignTitle] = useState("");
  const [designDesc, setDesignDesc] = useState("");
  const [designImage, setDesignImage] = useState("");
  const [designPrice, setDesignPrice] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchTemplates();
    fetchPayments();
  }, []);

  async function fetchTemplates() {
    try {
      const res = await fetch("/api/admin/templates");
      const data = await res.json();
      if (Array.isArray(data)) setTemplates(data);
    } catch (error) {
      console.error("Failed to load templates", error);
    }
  }

  async function fetchPayments() {
    try {
      const res = await fetch("/api/admin/payments");
      const data = await res.json();
      if (Array.isArray(data)) setPayments(data);
    } catch (error) {
      console.error("Failed to load payments", error);
    }
  }

  async function handleAddDesign(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    try {
      const res = await fetch("/api/admin/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: designTitle, description: designDesc, imageUrl: designImage, price: designPrice }),
      });
      if (res.ok) {
        setDesignTitle("");
        setDesignDesc("");
        setDesignImage("");
        setDesignPrice("");
        fetchTemplates();
      }
    } finally {
      setLoading(false);
    }
  }

  async function updatePayment(paymentId: string, status: "VERIFIED" | "REJECTED") {
    const rejectionReason = status === "REJECTED" ? window.prompt("Reason for rejection:") : undefined;
    if (status === "REJECTED" && !rejectionReason) return;
    const res = await fetch("/api/admin/payments", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paymentId, status, rejectionReason }),
    });
    if (res.ok) fetchPayments();
  }

  async function updateEvent(paymentId: string, eventAction: "AUTHORIZED" | "SUSPENDED") {
    const res = await fetch("/api/admin/payments", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paymentId, eventAction }),
    });
    if (res.ok) fetchPayments();
  }

  const submittedPayments = payments.filter((payment) => payment.status === "SUBMITTED").length;

  return (
    <main className="min-h-screen bg-gray-50 px-5 py-8 text-gray-900 md:px-10 md:py-12">
      <div className="mx-auto max-w-6xl">
        <header className="mb-8 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-blue-600">E-Card Portal</p>
            <h1 className="text-3xl font-bold tracking-tight text-gray-900">Admin dashboard</h1>
            <p className="mt-2 text-sm text-gray-500">Manage designs, review payments, and control event pricing.</p>
          </div>
          <button onClick={() => router.push("/login")} className="self-start rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 shadow-sm transition hover:border-red-200 hover:text-red-600 sm:self-auto">Log out</button>
        </header>

        <nav className="mb-6 flex flex-wrap gap-2 rounded-xl border border-gray-200 bg-white p-2 shadow-sm">
          <button onClick={() => setActiveTab("designs")} className={`rounded-lg px-4 py-2.5 text-sm font-semibold transition ${activeTab === "designs" ? "bg-blue-600 text-white shadow-sm" : "text-gray-600 hover:bg-gray-50"}`}>Card designs</button>
          <button onClick={() => setActiveTab("payments")} className={`rounded-lg px-4 py-2.5 text-sm font-semibold transition ${activeTab === "payments" ? "bg-blue-600 text-white shadow-sm" : "text-gray-600 hover:bg-gray-50"}`}>Payments{submittedPayments > 0 && <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">{submittedPayments}</span>}</button>
          <button onClick={() => router.push("/admin/pricing")} className="rounded-lg px-4 py-2.5 text-sm font-semibold text-gray-600 transition hover:bg-gray-50">Pricing manager</button>
        </nav>

        {activeTab === "designs" && <div className="grid gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <div className="mb-6"><h2 className="text-lg font-bold text-gray-900">Add a card design</h2><p className="mt-1 text-sm text-gray-500">Publish a reusable invitation template for organizers.</p></div>
            <form onSubmit={handleAddDesign} className="space-y-4">
              <label className="block text-sm font-semibold text-gray-700">Template title<input type="text" value={designTitle} onChange={(event) => setDesignTitle(event.target.value)} placeholder="Royal Gold Wedding" required className="mt-2 w-full rounded-lg border border-gray-200 bg-gray-50 px-3.5 py-3 text-sm text-gray-900 outline-none placeholder:text-gray-400 focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-100" /></label>
              <label className="block text-sm font-semibold text-gray-700">Description<input type="text" value={designDesc} onChange={(event) => setDesignDesc(event.target.value)} placeholder="Elegant floral theme" className="mt-2 w-full rounded-lg border border-gray-200 bg-gray-50 px-3.5 py-3 text-sm text-gray-900 outline-none placeholder:text-gray-400 focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-100" /></label>
              <label className="block text-sm font-semibold text-gray-700">Image preview URL<input type="url" value={designImage} onChange={(event) => setDesignImage(event.target.value)} placeholder="https://..." required className="mt-2 w-full rounded-lg border border-gray-200 bg-gray-50 px-3.5 py-3 text-sm text-gray-900 outline-none placeholder:text-gray-400 focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-100" /></label>
              <label className="block text-sm font-semibold text-gray-700">Design price<input type="number" step="0.01" value={designPrice} onChange={(event) => setDesignPrice(event.target.value)} placeholder="0.00" className="mt-2 w-full rounded-lg border border-gray-200 bg-gray-50 px-3.5 py-3 text-sm text-gray-900 outline-none placeholder:text-gray-400 focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-100" /></label>
              <button type="submit" disabled={loading} className="w-full rounded-lg bg-blue-600 px-4 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50">{loading ? "Publishing..." : "Publish design"}</button>
            </form>
          </section>
          <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <div className="mb-6"><h2 className="text-lg font-bold text-gray-900">Published designs</h2><p className="mt-1 text-sm text-gray-500">{templates.length} template{templates.length === 1 ? "" : "s"} available</p></div>
            {templates.length === 0 ? <p className="rounded-lg border border-dashed border-gray-200 bg-gray-50 p-8 text-center text-sm text-gray-500">No templates uploaded yet.</p> : <div className="grid gap-3 sm:grid-cols-2">{templates.map((template) => <article key={template.id} className="overflow-hidden rounded-lg border border-gray-200 bg-gray-50"><img src={template.imageUrl} alt={template.title} className="h-32 w-full object-cover" /><div className="p-3"><h3 className="truncate text-sm font-bold text-gray-900">{template.title}</h3><p className="mt-1 line-clamp-2 text-xs text-gray-500">{template.description || "No description"}</p><p className="mt-3 text-sm font-bold text-blue-600">{template.price.toLocaleString()} TSh</p></div></article>)}</div>}
          </section>
        </div>}

        {activeTab === "payments" && <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="mb-6"><h2 className="text-lg font-bold text-gray-900">Payment review</h2><p className="mt-1 text-sm text-gray-500">Verify submitted payments before authorizing events.</p></div>
          {payments.length === 0 ? <p className="rounded-lg border border-dashed border-gray-200 bg-gray-50 p-8 text-center text-sm text-gray-500">No payment records found.</p> : <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left text-sm"><thead><tr className="border-b border-gray-200 text-xs uppercase tracking-wider text-gray-500"><th className="px-3 py-3 font-semibold">Client</th><th className="px-3 py-3 font-semibold">Event</th><th className="px-3 py-3 font-semibold">Amount</th><th className="px-3 py-3 font-semibold">Status</th><th className="px-3 py-3 font-semibold">Actions</th></tr></thead><tbody>{payments.map((payment) => <tr key={payment.id} className="border-b border-gray-100 last:border-0"><td className="px-3 py-4 font-semibold text-gray-800">{payment.user?.name || payment.user?.email || "Unknown"}</td><td className="px-3 py-4 text-gray-600">{payment.event?.title || "Event"}</td><td className="px-3 py-4 font-semibold text-gray-800">{Number(payment.amount).toLocaleString()} TSh</td><td className="px-3 py-4"><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${payment.status === "VERIFIED" ? "bg-emerald-100 text-emerald-700" : payment.status === "REJECTED" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}>{payment.status}</span></td><td className="px-3 py-4"><div className="flex flex-wrap gap-2">{payment.status === "SUBMITTED" && <><button onClick={() => updatePayment(payment.id, "VERIFIED")} className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700">Verify</button><button onClick={() => updatePayment(payment.id, "REJECTED")} className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-red-700">Reject</button></>}{payment.status === "VERIFIED" && payment.event?.status !== "AUTHORIZED" && <button onClick={() => updateEvent(payment.id, "AUTHORIZED")} className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-blue-700">Authorize event</button>}{payment.event?.status === "AUTHORIZED" && <button onClick={() => updateEvent(payment.id, "SUSPENDED")} className="rounded-md bg-violet-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-violet-700">Suspend event</button>}</div></td></tr>)}</tbody></table></div>}
        </section>}
      </div>
    </main>
  );
}
