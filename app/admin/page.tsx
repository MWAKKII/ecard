"use client";

import { useEffect, useRef, useState } from "react";

const MAX_UPLOAD_BYTES = 4 * 1024 * 1024; // keep in sync with /api/admin/templates
const MAX_SOURCE_BYTES = 12 * 1024 * 1024; // reject monster files before decoding
const ACCEPTED_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif", "image/avif"];

function readAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read that file"));
    reader.readAsDataURL(file);
  });
}

/**
 * Downscale large photos (max 1600px) and re-encode so the stored design stays
 * small — a phone photo can be 8 MB before this and ~200 KB after.
 */
async function encodeForStorage(file: File): Promise<string> {
  if (file.type === "image/gif") return readAsDataURL(file); // keep animation
  const bitmap = await createImageBitmap(file);
  const maxSide = 1600;
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close();
    throw new Error("Your browser could not process that image");
  }
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  let dataUrl = file.type === "image/png" ? canvas.toDataURL("image/png") : canvas.toDataURL("image/jpeg", 0.85);
  // PNG screenshots can still be heavy — fall back to JPEG if over the cap.
  if (dataUrl.length > MAX_UPLOAD_BYTES) dataUrl = canvas.toDataURL("image/jpeg", 0.8);
  if (dataUrl.length > MAX_UPLOAD_BYTES) {
    throw new Error("That image is too large even after compression — try a smaller file");
  }
  return dataUrl;
}
import { useRouter } from "next/navigation";

interface Template {
  id: string;
  title: string;
  imageUrl: string;
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
  const [designFile, setDesignFile] = useState<{ dataUrl: string; name: string; size: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [designError, setDesignError] = useState("");
  const [loading, setLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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

  async function handleFile(file: File) {
    setDesignError("");
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setDesignError("Please choose a PNG, JPEG, WebP, GIF or AVIF image file.");
      return;
    }
    if (file.size > MAX_SOURCE_BYTES) {
      setDesignError("That file is larger than 12 MB — please pick a smaller image.");
      return;
    }
    try {
      const dataUrl = await encodeForStorage(file);
      setDesignFile({ dataUrl, name: file.name, size: Math.round((dataUrl.length * 3) / 4) });
    } catch (error) {
      setDesignError(error instanceof Error ? error.message : "Could not load that image");
    }
  }

  async function handleAddDesign(event: React.FormEvent) {
    event.preventDefault();
    if (!designFile) {
      setDesignError("Choose a design image first.");
      return;
    }
    setLoading(true);
    setDesignError("");
    try {
      const res = await fetch("/api/admin/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: designTitle, imageUrl: designFile.dataUrl }),
      });
      const data = await res.json().catch(() => ({}) as Record<string, string>);
      if (!res.ok) {
        setDesignError(data.error || "Failed to publish the design");
        return;
      }
      setDesignTitle("");
      setDesignFile(null);
      fetchTemplates();
    } catch {
      setDesignError("Unable to connect to the design service.");
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
          <button onClick={() => router.push("/admin/users")} className="rounded-lg px-4 py-2.5 text-sm font-semibold text-gray-600 transition hover:bg-gray-50">Users</button>
        </nav>

        {activeTab === "designs" && <div className="grid gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <div className="mb-6"><h2 className="text-lg font-bold text-gray-900">Add a card design</h2><p className="mt-1 text-sm text-gray-500">Publish a reusable invitation template for organizers.</p></div>
            <form onSubmit={handleAddDesign} className="space-y-4">
              <label className="block text-sm font-semibold text-gray-700">Template title<input type="text" value={designTitle} onChange={(event) => setDesignTitle(event.target.value)} placeholder="Royal Gold Wedding" required className="mt-2 w-full rounded-lg border border-gray-200 bg-gray-50 px-3.5 py-3 text-sm text-gray-900 outline-none placeholder:text-gray-400 focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-100" /></label>
              <div>
                <p className="block text-sm font-semibold text-gray-700">Design image</p>
                <input ref={fileInputRef} type="file" accept={ACCEPTED_TYPES.join(",")} className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void handleFile(file); event.target.value = ""; }} />
                <div
                  role="button"
                  tabIndex={0}
                  aria-label="Upload a design image"
                  onClick={() => fileInputRef.current?.click()}
                  onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); fileInputRef.current?.click(); } }}
                  onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={(event) => { event.preventDefault(); setDragging(false); const file = event.dataTransfer.files?.[0]; if (file) void handleFile(file); }}
                  className={`mt-2 cursor-pointer rounded-xl border-2 border-dashed px-4 py-7 text-center outline-none transition ${dragging ? "border-blue-500 bg-blue-50" : "border-gray-300 bg-gray-50 hover:border-blue-400 hover:bg-white"}`}
                >
                  {designFile ? (
                    <div className="space-y-2">
                      <img src={designFile.dataUrl} alt="Selected design preview" className="mx-auto max-h-44 rounded-lg border border-gray-200 object-contain" />
                      <p className="truncate text-xs font-semibold text-gray-700">{designFile.name} · {(designFile.size / (1024 * 1024)).toFixed(2)} MB</p>
                      <p className="text-xs text-gray-500">Click or drop another image to replace it</p>
                    </div>
                  ) : (
                    <>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="mx-auto h-8 w-8 text-gray-400"><path d="M12 16V4m0 0L7 9m5-5 5 5" /><path d="M4 16v2a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3v-2" /></svg>
                      <p className="mt-2 text-sm font-semibold text-gray-700">Drag &amp; drop your design here</p>
                      <p className="mt-1 text-xs text-gray-500">or <span className="font-semibold text-blue-600">browse your PC</span> — PNG, JPEG, WebP, GIF or AVIF, up to 4 MB</p>
                    </>
                  )}
                </div>
                {designFile && <button type="button" onClick={() => { setDesignFile(null); setDesignError(""); }} className="mt-2 text-xs font-semibold text-red-600 transition hover:text-red-700">Remove image</button>}
              </div>
              {designError && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">{designError}</p>}
              <button type="submit" disabled={loading || !designFile} className="w-full rounded-lg bg-blue-600 px-4 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50">{loading ? "Publishing..." : "Publish design"}</button>
            </form>
          </section>
          <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <div className="mb-6"><h2 className="text-lg font-bold text-gray-900">Published designs</h2><p className="mt-1 text-sm text-gray-500">{templates.length} template{templates.length === 1 ? "" : "s"} available</p></div>
            {templates.length === 0 ? <p className="rounded-lg border border-dashed border-gray-200 bg-gray-50 p-8 text-center text-sm text-gray-500">No templates uploaded yet.</p> : <div className="grid gap-3 sm:grid-cols-2">{templates.map((template) => <article key={template.id} className="overflow-hidden rounded-lg border border-gray-200 bg-gray-50"><img src={template.imageUrl} alt={template.title} className="h-32 w-full object-cover" /><div className="p-3"><h3 className="truncate text-sm font-bold text-gray-900">{template.title}</h3></div></article>)}</div>}
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
