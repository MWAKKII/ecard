"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

/**
 * Persistent admin shell: the section tabs stay visible on every /admin page
 * and each tab is a real link, so switching sections is a normal navigation
 * (browser back/forward and deep links work).
 */
const TABS = [
  { href: "/admin", label: "Card designs" },
  { href: "/admin/payments", label: "Payments" },
  { href: "/admin/pricing", label: "Pricing manager" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/overrides", label: "Overrides" },
] as const;

export default function AdminShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [pendingPayments, setPendingPayments] = useState(0);
  const [loggingOut, setLoggingOut] = useState(false);

  // Best-effort badge for payments waiting for review; refreshed on navigation.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/admin/payments", { credentials: "include" });
        const data = await res.json();
        if (!cancelled && Array.isArray(data)) {
          setPendingPayments(
            data.filter((payment: { status?: string }) => payment.status === "SUBMITTED").length,
          );
        }
      } catch {
        /* the badge is optional - never block the page */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      router.push("/login");
      router.refresh();
    }
  }

  return (
    <main className="min-h-screen bg-gray-50 px-5 py-8 text-gray-900 md:px-10 md:py-12">
      <div className="mx-auto max-w-6xl">
        <header className="mb-8 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-blue-600">
              E-Card Portal
            </p>
            <h1 className="text-3xl font-bold tracking-tight text-gray-900">Admin dashboard</h1>
            <p className="mt-2 text-sm text-gray-500">
              Manage designs, review payments, control pricing, and correct event data.
            </p>
          </div>
          <button
            onClick={handleLogout}
            disabled={loggingOut}
            className="self-start rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 shadow-sm transition hover:border-red-200 hover:text-red-600 disabled:opacity-50 sm:self-auto"
          >
            {loggingOut ? "Logging out..." : "Log out"}
          </button>
        </header>

        <nav
          aria-label="Admin sections"
          className="mb-6 flex flex-wrap gap-2 rounded-xl border border-gray-200 bg-white p-2 shadow-sm"
        >
          {TABS.map((tab) => {
            const active =
              tab.href === "/admin" ? pathname === "/admin" : pathname.startsWith(tab.href);
            return (
              <Link
                key={tab.href}
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={`rounded-lg px-4 py-2.5 text-sm font-semibold transition ${
                  active ? "bg-blue-600 text-white shadow-sm" : "text-gray-600 hover:bg-gray-50"
                }`}
              >
                {tab.label}
                {tab.href === "/admin/payments" && pendingPayments > 0 && (
                  <span
                    className={`ml-2 rounded-full px-2 py-0.5 text-xs ${
                      active ? "bg-white/20 text-white" : "bg-amber-100 text-amber-800"
                    }`}
                  >
                    {pendingPayments}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        {children}
      </div>
    </main>
  );
}
