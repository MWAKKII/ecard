import { connection } from "next/server";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";

export default async function DatabaseVerifyPage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  await connection();

  let error: string | null = null;
  let counts: Record<string, number> | null = null;

  try {
    counts = {
      users: await prisma.user.count(),
      pricingTiers: await prisma.pricingTier.count(),
      events: await prisma.event.count(),
      guests: await prisma.guest.count(),
      attendances: await prisma.attendance.count(),
      cardTemplates: await prisma.cardTemplate.count(),
      payments: await prisma.payment.count(),
      auditLogs: await prisma.auditLog.count(),
    };
  } catch (caught) {
    error = caught instanceof Error ? caught.message : "Unknown database error";
  }

  return (
    <main className="mx-auto flex min-h-full w-full max-w-xl flex-col gap-6 p-8 font-sans">
      <h1 className="text-2xl font-semibold">Database check</h1>
      <p className="text-zinc-600 dark:text-zinc-400">
        Development-only counts from Prisma. This is not a product UI.
      </p>
      {error ? (
        <pre className="overflow-auto rounded-md bg-red-50 p-4 text-sm text-red-800">
          {error}
        </pre>
      ) : (
        <ul className="space-y-2 font-mono text-sm">
          {Object.entries(counts ?? {}).map(([table, count]) => (
            <li key={table} className="flex justify-between border-b border-zinc-200 py-1">
              <span>{table}</span>
              <span>{count}</span>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
