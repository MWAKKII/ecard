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

interface TemplateLayoutSummary {
  placeholders?: {
    eventTitle?: unknown;
    guestName?: unknown;
    quality?: unknown;
    qr?: unknown;
  };
}

interface Template {
  id: string;
  title: string;
  imageUrl: string;
  status: "DRAFT" | "ACTIVE" | "ARCHIVED";
  layout?: TemplateLayoutSummary | null;
  _count?: { events: number };
}

/** Human-readable list of the placeholders detected on a design. */
function detectedPlaceholders(template: Pick<Template, "layout">): string[] {
  const placeholders = template.layout?.placeholders;
  const labels: string[] = [];
  if (placeholders?.eventTitle) labels.push("event title");
  if (placeholders?.guestName) labels.push("guest name");
  if (placeholders?.quality) labels.push("card quality");
  if (placeholders?.qr) labels.push("QR code");
  return labels;
}

export default function AdminDesignsPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [designTitle, setDesignTitle] = useState("");
  const [designFile, setDesignFile] = useState<{ dataUrl: string; name: string; size: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [designError, setDesignError] = useState("");
  const [loading, setLoading] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [actionNotice, setActionNotice] = useState("");
  const [actionError, setActionError] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    fetchTemplates();
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
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        template?: { title?: string; layout?: TemplateLayoutSummary | null };
      };
      if (!res.ok) {
        setDesignError(data.error || "Failed to publish the design");
        return;
      }
      setDesignTitle("");
      setDesignFile(null);
      const detected = data.template ? detectedPlaceholders(data.template) : [];
      setActionNotice(
        `"${data.template?.title ?? designTitle.trim()}" was published${
          detected.length > 0
            ? ` — detected ${detected.join(", ")}. New guest cards will personalize automatically.`
            : "."
        }`,
      );
      fetchTemplates();
    } catch {
      setDesignError("Unable to connect to the design service.");
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(template: Template) {
    setDeleting(true);
    setActionError("");
    setActionNotice("");
    try {
      const res = await fetch(`/api/admin/templates/${template.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not delete the design");
      setTemplates((prev) => prev.filter((item) => item.id !== template.id));
      setSelectedTemplateId(null);
      setConfirmDelete(false);
      setActionNotice(`"${template.title}" was deleted.`);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not delete the design");
    } finally {
      setDeleting(false);
    }
  }

  const selectedTemplate = templates.find((template) => template.id === selectedTemplateId) ?? null;
  const selectedUsage = selectedTemplate?._count?.events ?? 0;
  const selectedPlaceholders = selectedTemplate ? detectedPlaceholders(selectedTemplate) : [];

  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-xl font-bold tracking-tight text-gray-900">Card designs</h2>
        <p className="mt-1 text-sm text-gray-500">Publish reusable invitation templates for organizers.</p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
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
          <div className="mb-6"><h2 className="text-lg font-bold text-gray-900">Published designs</h2><p className="mt-1 text-sm text-gray-500">{templates.length} template{templates.length === 1 ? "" : "s"} available — select one to manage it</p></div>
          {templates.length === 0 ? (
            <p className="rounded-lg border border-dashed border-gray-200 bg-gray-50 p-8 text-center text-sm text-gray-500">No templates uploaded yet.</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {templates.map((template) => {
                const selected = template.id === selectedTemplateId;
                return (
                  <button
                    key={template.id}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => {
                      setSelectedTemplateId(selected ? null : template.id);
                      setConfirmDelete(false);
                      setActionNotice("");
                      setActionError("");
                    }}
                    className={`overflow-hidden rounded-lg border text-left transition focus:outline-none focus:ring-2 focus:ring-blue-200 ${
                      selected ? "border-blue-500 ring-2 ring-blue-100" : "border-gray-200 hover:border-blue-300"
                    }`}
                  >
                    <div className="relative">
                      <img src={template.imageUrl} alt={template.title} className="h-32 w-full object-cover" />
                      {selected && (
                        <span className="absolute right-2 top-2 rounded-full bg-blue-600 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white shadow">
                          Selected
                        </span>
                      )}
                    </div>
                    <div className="flex items-center justify-between gap-2 bg-gray-50 p-3">
                      <h3 className="truncate text-sm font-bold text-gray-900">{template.title}</h3>
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                          template.status === "ACTIVE"
                            ? "bg-emerald-100 text-emerald-700"
                            : template.status === "ARCHIVED"
                              ? "bg-gray-200 text-gray-600"
                              : "bg-amber-100 text-amber-700"
                        }`}
                      >
                        {template.status}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {selectedTemplate ? (
            <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-blue-900">
                  <span className="mr-2 text-xs font-bold uppercase tracking-wide text-blue-600">Selected</span>
                  <span className="font-bold">{selectedTemplate.title}</span>
                  <span className="ml-2 text-xs text-blue-700">
                    used by {selectedUsage} event{selectedUsage === 1 ? "" : "s"}
                  </span>
                </p>
                {!confirmDelete && (
                  <button
                    type="button"
                    onClick={() => {
                      setConfirmDelete(true);
                      setActionNotice("");
                      setActionError("");
                    }}
                    className="rounded-lg border border-red-200 bg-white px-3 py-2 text-xs font-bold text-red-600 transition hover:bg-red-50"
                  >
                    Delete design
                  </button>
                )}
              </div>

              {selectedPlaceholders.length > 0 ? (
                <p className="mt-2 rounded-md border border-emerald-200 bg-white px-2.5 py-1.5 text-[11px] font-medium text-emerald-700">
                  Placeholders detected: {selectedPlaceholders.join(", ")}. New guest cards will
                  replace these automatically.
                </p>
              ) : selectedTemplate.layout ? (
                <p className="mt-2 rounded-md border border-blue-200 bg-white px-2.5 py-1.5 text-[11px] text-blue-700">
                  No placeholder words were found. Cards use the standard overlay layout.
                </p>
              ) : (
                <p className="mt-2 rounded-md border border-blue-200 bg-white px-2.5 py-1.5 text-[11px] text-blue-700">
                  Placeholder analysis has not run for this older design yet — it runs automatically
                  the first time a card is generated.
                </p>
              )}

              {confirmDelete && (
                <div className="mt-3 rounded-lg border border-red-200 bg-white p-3">
                  <p className="text-sm font-semibold text-red-700">Delete &quot;{selectedTemplate.title}&quot;?</p>
                  <p className="mt-1 text-xs text-gray-600">
                    {selectedUsage === 1
                      ? "1 event uses this design. It will lose the assignment and must choose another design before new cards can be generated."
                      : selectedUsage > 1
                        ? `${selectedUsage} events use this design. They will lose the assignment and must choose another design before new cards can be generated.`
                        : "This permanently removes the design from the library."}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => handleDelete(selectedTemplate)}
                      disabled={deleting}
                      className="rounded-lg bg-red-600 px-3 py-2 text-xs font-bold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {deleting ? "Deleting..." : "Yes, delete design"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(false)}
                      disabled={deleting}
                      className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-600 transition hover:bg-gray-50 disabled:opacity-50"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            templates.length > 0 && <p className="mt-4 text-xs text-gray-400">Select a design to manage it.</p>
          )}

          {actionNotice && (
            <p className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700">{actionNotice}</p>
          )}
          {actionError && (
            <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">{actionError}</p>
          )}
        </section>
      </div>
    </div>
  );
}
