"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

interface UserProfile {
  name?: string | null;
  username?: string | null;
}

function getGreeting(timeZone: string) {
  const hourPart = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    hour12: false,
    timeZone,
  }).formatToParts(new Date()).find((part) => part.type === "hour");
  const hour = Number(hourPart?.value ?? 0);
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export default function ClientDashboard() {
  const router = useRouter();
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [user, setUser] = useState<UserProfile | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [greeting, setGreeting] = useState<string | null>(null);

  useEffect(() => {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const updateGreeting = () => setGreeting(getGreeting(timeZone));
    const initialUpdate = window.setTimeout(updateGreeting, 0);
    const greetingTimer = window.setInterval(updateGreeting, 60_000);

    fetch("/api/user/profile")
      .then((response) => response.json().then((data) => ({ response, data })))
      .then(({ response, data }) => {
        if (response.ok) setUser(data);
      })
      .catch((error) => console.error("Failed to load profile", error))
      .finally(() => setLoading(false));

    function closeMenu(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) setDropdownOpen(false);
    }
    document.addEventListener("mousedown", closeMenu);
    return () => {
      window.clearTimeout(initialUpdate);
      window.clearInterval(greetingTimer);
      document.removeEventListener("mousedown", closeMenu);
    };
  }, []);

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  const displayName = user?.username || user?.name || "Client";
  const initial = displayName.charAt(0).toUpperCase();

  if (loading) {
    return <main className="min-h-screen bg-white flex items-center justify-center text-slate-500"><div className="animate-pulse rounded-full bg-slate-100 px-6 py-3">Preparing your dashboard...</div></main>;
  }

  return (
    <main className="min-h-screen bg-white text-slate-900">
      <nav className="sticky top-0 z-20 border-b border-slate-200/70 bg-white/75 px-5 py-4 backdrop-blur-xl md:px-10">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-900 text-lg text-white shadow-lg">✦</span><span className="font-semibold tracking-tight">E-Card Portal</span></div>
          <div className="relative" ref={dropdownRef}>
            <button aria-label="Open account menu" onClick={() => setDropdownOpen(!dropdownOpen)} className="flex h-11 w-11 items-center justify-center rounded-full bg-slate-900 font-semibold text-white shadow-lg transition hover:-translate-y-0.5 hover:bg-blue-600">{initial}</button>
            {dropdownOpen && <div className="absolute right-0 top-14 w-48 overflow-hidden rounded-2xl border border-slate-200 bg-white/90 p-2 shadow-2xl backdrop-blur-xl"><Link href="/dashboard/profile" className="block rounded-xl px-4 py-3 text-sm font-medium hover:bg-slate-100">Profile</Link><button onClick={handleLogout} className="w-full rounded-xl px-4 py-3 text-left text-sm font-medium text-rose-600 hover:bg-rose-50">Log out</button></div>}
          </div>
        </div>
      </nav>
      <section className="mx-auto max-w-6xl px-5 py-12 md:px-10 md:py-20">
        <div className="mb-12"><p className="mb-3 text-sm font-semibold uppercase tracking-[0.2em] text-blue-600">Your workspace</p><h1 className="text-4xl font-bold tracking-tight md:text-6xl">{greeting || "Loading your welcome"}, <span className="text-blue-600">{displayName}</span>.</h1><p className="mt-4 max-w-xl text-base leading-7 text-slate-500">Your events are ready when you are. Let&apos;s make something worth remembering.</p></div>
        <div className="grid gap-6 md:grid-cols-2">
          <Link href="/events" className="group rounded-[28px] border border-slate-200 bg-white/80 p-8 shadow-[0_20px_60px_rgba(15,23,42,0.08)] backdrop-blur-xl transition duration-300 hover:-translate-y-1 hover:border-blue-300"><span className="mb-8 block text-4xl transition group-hover:scale-110">◌</span><h2 className="text-2xl font-semibold">My events</h2><p className="mt-2 text-slate-500">Track payment status, event approval, and invitation progress.</p><span className="mt-8 inline-flex rounded-full bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition group-hover:bg-blue-600">Manage events <span className="ml-3">→</span></span></Link>
          <Link href="/events/create" className="group rounded-[28px] border border-slate-200 bg-white/80 p-8 shadow-[0_20px_60px_rgba(15,23,42,0.08)] backdrop-blur-xl transition duration-300 hover:-translate-y-1 hover:border-emerald-300"><span className="mb-8 block text-4xl transition group-hover:rotate-12">＋</span><h2 className="text-2xl font-semibold">Create an event</h2><p className="mt-2 text-slate-500">Start with a date, a quote, and a little imagination.</p><span className="mt-8 inline-flex rounded-full bg-emerald-600 px-5 py-3 text-sm font-semibold text-white transition group-hover:bg-emerald-500">New event <span className="ml-3">→</span></span></Link>
        </div>
      </section>
    </main>
  );
}
