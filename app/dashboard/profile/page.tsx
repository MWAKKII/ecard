"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface UserProfile {
  name: string;
  email: string;
  username: string;
  phone: string;
}

const emptyProfile: UserProfile = { name: "", email: "", username: "", phone: "" };

export default function ProfilePage() {
  const router = useRouter();
  const [user, setUser] = useState<UserProfile>(emptyProfile);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [message, setMessage] = useState("");

  async function fetchProfile() {
    try {
      const response = await fetch("/api/user/profile");
      const data = await response.json();
      if (response.ok) setUser({ ...emptyProfile, ...data });
      else setMessage(data.error || "Unable to load your profile.");
    } catch {
      setMessage("Unable to load your profile.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => { void fetchProfile(); }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function handleSave(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/user/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: user.name, username: user.username, phone: user.phone }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to update profile.");
      setUser(data.user);
      setIsEditing(false);
      setMessage("Profile updated successfully.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to update profile.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <main className="flex min-h-screen items-center justify-center bg-white text-slate-500"><div className="animate-pulse rounded-full bg-slate-100 px-6 py-3">Loading your profile...</div></main>;

  const initial = (user.username || user.name || "C").charAt(0).toUpperCase();
  const inputClass = "w-full rounded-2xl border border-slate-200 bg-white/70 px-4 py-3 text-slate-900 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 disabled:cursor-default disabled:bg-slate-100/60";

  return (
    <main className="min-h-screen bg-white px-5 py-8 text-slate-900 md:px-10 md:py-12">
      <div className="mx-auto max-w-3xl">
        <div className="mb-8 flex items-center justify-between gap-4">
          <button onClick={() => router.push("/dashboard")} className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 shadow-sm transition hover:-translate-x-1 hover:border-blue-300 hover:text-blue-600">← Back</button>
          {!isEditing && <button onClick={() => setIsEditing(true)} className="rounded-full bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white shadow-lg transition hover:-translate-y-0.5 hover:bg-blue-600">Edit</button>}
        </div>

        <section className="rounded-[32px] border border-slate-200 bg-white/80 p-6 shadow-[0_24px_80px_rgba(15,23,42,0.09)] backdrop-blur-xl md:p-10">
          <div className="mb-10 flex items-center gap-5 border-b border-slate-100 pb-8"><div className="flex h-20 w-20 items-center justify-center rounded-[26px] bg-slate-900 text-3xl font-bold text-white shadow-xl">{initial}</div><div><p className="text-sm font-semibold uppercase tracking-[0.18em] text-blue-600">Account profile</p><h1 className="mt-1 text-3xl font-bold tracking-tight">{user.username || user.name || "Your profile"}</h1><p className="mt-1 text-sm text-slate-500">Keep your account details current.</p></div></div>

          {message && <div className="mb-6 rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-700">{message}</div>}
          <form onSubmit={handleSave} className="grid gap-5 md:grid-cols-2">
            <label className="text-sm font-semibold text-slate-600">Full name<input className={`${inputClass} mt-2 font-normal`} value={user.name} disabled={!isEditing} onChange={(event) => setUser({ ...user, name: event.target.value })} required /></label>
            <label className="text-sm font-semibold text-slate-600">Username<input className={`${inputClass} mt-2 font-normal`} value={user.username} disabled={!isEditing} onChange={(event) => setUser({ ...user, username: event.target.value })} required /></label>
            <label className="text-sm font-semibold text-slate-600">Email address<input className={`${inputClass} mt-2 font-normal`} value={user.email} disabled /></label>
            <label className="text-sm font-semibold text-slate-600">Phone number<input className={`${inputClass} mt-2 font-normal`} value={user.phone} disabled={!isEditing} onChange={(event) => setUser({ ...user, phone: event.target.value })} /></label>
            {isEditing && <div className="flex gap-3 pt-3 md:col-span-2"><button type="submit" disabled={saving} className="rounded-full bg-blue-600 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-500 disabled:animate-pulse disabled:opacity-60">{saving ? "Saving..." : "Save changes"}</button><button type="button" onClick={() => { setIsEditing(false); fetchProfile(); }} className="rounded-full border border-slate-200 px-6 py-3 text-sm font-semibold text-slate-600 transition hover:bg-slate-50">Cancel</button></div>}
          </form>
        </section>
      </div>
    </main>
  );
}
