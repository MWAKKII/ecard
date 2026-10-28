"use client";

import { useCallback, useEffect, useState } from "react";
import type { EventReport } from "@/lib/report-types";
import {
  attendanceLabel,
  cardTypeLabel,
  formatDateTime,
  formatPercent,
} from "@/lib/report-format";

interface EventReportProps {
  eventId: string;
}

function attendanceBadgeClass(status: string): string {
  if (status === "CHECKED_IN") return "bg-emerald-100 text-emerald-700";
  if (status === "NO_SHOW") return "bg-red-100 text-red-700";
  if (status === "LEFT") return "bg-blue-100 text-blue-700";
  return "bg-gray-100 text-gray-600";
}

/**
 * Read-only post-event report. The API only exposes GET, so this screen has
 * no editing controls at all: every number comes from attendance records.
 */
export default function EventReport({ eventId }: EventReportProps) {
  const [report, setReport] = useState<EventReport | null>(null);
  const [lockedAt, setLockedAt] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const res = await fetch(`/api/events/${eventId}/report`, {
          credentials: "include",
          cache: "no-store",
          signal,
        });
        const data: unknown = await res.json().catch(() => null);

        if (res.status === 403) {
          const payload = data as { availableAt?: unknown } | null;
          if (payload && typeof payload.availableAt === "string") {
            setLockedAt(payload.availableAt);
            return;
          }
        }

        if (!res.ok) {
          const payload = data as { error?: unknown } | null;
          throw new Error(
            typeof payload?.error === "string"
              ? payload.error
              : "Could not load the report",
          );
        }

        if (!data || typeof data !== "object" || !("totals" in data)) {
          throw new Error("The report response was invalid");
        }

        setReport(data as EventReport);
      } catch (err) {
        if (signal?.aborted) return;
        setError(err instanceof Error ? err.message : "Could not load the report");
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [eventId],
  );

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      await load(controller.signal);
    })();
    return () => controller.abort();
  }, [load]);

  function retry() {
    setLoading(true);
    setError("");
    setLockedAt(null);
    setReport(null);
    void load();
  }

  if (loading) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-12 text-center shadow-sm">
        <p className="animate-pulse font-medium text-gray-500">Calculating report...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-8 text-center">
        <h2 className="text-lg font-bold text-red-800">Could not load the report</h2>
        <p className="mt-1 text-sm text-red-700">{error}</p>
        <button
          type="button"
          onClick={retry}
          className="mt-4 rounded-lg bg-red-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-red-700"
        >
          Try again
        </button>
      </div>
    );
  }

  if (lockedAt) {
    return (
      <div className="rounded-xl border border-dashed border-amber-300 bg-amber-50 p-12 text-center">
        <p className="text-4xl">🔒</p>
        <h2 className="mt-3 text-lg font-bold text-amber-900">Report locked</h2>
        <p className="mt-1 text-sm text-amber-800">
          This report becomes available after the event date has passed.
        </p>
        <p className="mt-2 text-sm font-semibold text-amber-900">
          Available from {formatDateTime(lockedAt)}
        </p>
        <p className="mx-auto mt-4 max-w-xl text-xs text-amber-700">
          The report is generated from the attendance records at the moment you open it. It is
          read-only and cannot be edited manually.
        </p>
      </div>
    );
  }

  if (!report) return null;

  const { totals, byCardType, guests } = report;
  const metrics = [
    { label: "Total guests", value: String(totals.totalGuests), tone: "text-gray-900" },
    { label: "Attended", value: String(totals.attended), tone: "text-emerald-600" },
    { label: "Not attended", value: String(totals.notAttended), tone: "text-amber-600" },
    { label: "Attendance", value: formatPercent(totals.attendancePercent), tone: "text-blue-600" },
    {
      label: "Non-attendance",
      value: formatPercent(totals.nonAttendancePercent),
      tone: "text-rose-600",
    },
  ];

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-blue-600">Post-event report</p>
            <h2 className="mt-2 text-2xl font-bold text-gray-900">{report.event.title}</h2>
            <p className="mt-1 text-sm text-gray-500">
              {formatDateTime(report.event.startsAt)}
              {report.event.location ? ` · ${report.event.location}` : ""}
            </p>
            <p className="mt-1 text-xs text-gray-500">
              Generated {formatDateTime(report.generatedAt)}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-bold uppercase tracking-wider text-gray-600">
              Read-only
            </span>
            <a
              href={`/api/events/${report.event.id}/report?format=pdf`}
              download
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700"
            >
              Download PDF
            </a>
            <a
              href={`/api/events/${report.event.id}/report?format=csv`}
              download
              className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-bold text-gray-700 shadow-sm transition hover:bg-gray-50"
            >
              Download CSV
            </a>
          </div>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {metrics.map((metric) => (
          <div key={metric.label} className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-bold uppercase tracking-wider text-gray-500">{metric.label}</p>
            <p className={`mt-2 text-3xl font-bold ${metric.tone}`}>{metric.value}</p>
          </div>
        ))}
      </section>

      <section className="rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-200 p-6">
          <h3 className="text-lg font-bold text-gray-900">Card type breakdown</h3>
          <p className="mt-1 text-sm text-gray-500">
            Attendance by the card type assigned to each guest.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-gray-50 text-left text-xs font-bold uppercase tracking-wider text-gray-500">
              <tr>
                <th className="px-6 py-3">Card type</th>
                <th className="px-6 py-3 text-right">Total guests</th>
                <th className="px-6 py-3 text-right">Attended</th>
                <th className="px-6 py-3 text-right">Not attended</th>
                <th className="px-6 py-3 text-right">Attendance %</th>
                <th className="px-6 py-3 text-right">Non-attendance %</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {byCardType.map((row) => (
                <tr key={row.cardType}>
                  <td className="px-6 py-4 font-semibold text-gray-900">
                    <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700">
                      {cardTypeLabel(row.cardType)}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right font-semibold text-gray-900">{row.totalGuests}</td>
                  <td className="px-6 py-4 text-right font-semibold text-emerald-600">{row.attended}</td>
                  <td className="px-6 py-4 text-right font-semibold text-amber-600">{row.notAttended}</td>
                  <td className="px-6 py-4 text-right text-gray-700">{formatPercent(row.attendancePercent)}</td>
                  <td className="px-6 py-4 text-right text-gray-700">
                    {formatPercent(row.nonAttendancePercent)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t border-gray-200 bg-gray-50 font-bold text-gray-900">
              <tr>
                <td className="px-6 py-4">All guests</td>
                <td className="px-6 py-4 text-right">{totals.totalGuests}</td>
                <td className="px-6 py-4 text-right text-emerald-600">{totals.attended}</td>
                <td className="px-6 py-4 text-right text-amber-600">{totals.notAttended}</td>
                <td className="px-6 py-4 text-right">{formatPercent(totals.attendancePercent)}</td>
                <td className="px-6 py-4 text-right">{formatPercent(totals.nonAttendancePercent)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      <section className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-200 p-6">
          <h3 className="text-lg font-bold text-gray-900">Full guest list</h3>
          <p className="mt-1 text-sm text-gray-500">
            {guests.length} guest{guests.length === 1 ? "" : "s"} · attendance status and scan time
            for every registered guest.
          </p>
        </div>

        {guests.length === 0 ? (
          <p className="p-8 text-center text-sm text-gray-500">
            No guests were registered for this event.
          </p>
        ) : (
          <div className="max-h-[32rem] overflow-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="sticky top-0 z-10 bg-gray-50 text-left text-xs font-bold uppercase tracking-wider text-gray-500">
                <tr>
                  <th className="px-4 py-3">#</th>
                  <th className="px-4 py-3">Guest</th>
                  <th className="px-4 py-3">Phone</th>
                  <th className="px-4 py-3">Card type</th>
                  <th className="px-4 py-3">Attendance</th>
                  <th className="px-4 py-3">Scan time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {guests.map((guest, index) => (
                  <tr key={guest.id} className="align-top">
                    <td className="px-4 py-3 text-gray-400">{index + 1}</td>
                    <td className="px-4 py-3">
                      <p className="font-semibold text-gray-900">{guest.fullName}</p>
                      {guest.email && <p className="mt-0.5 text-xs text-gray-500">{guest.email}</p>}
                    </td>
                    <td className="px-4 py-3 text-gray-600">{guest.phone || "—"}</td>
                    <td className="px-4 py-3 text-gray-600">{cardTypeLabel(guest.cardType)}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-bold ${attendanceBadgeClass(
                          guest.attendanceStatus,
                        )}`}
                      >
                        {attendanceLabel(guest.attendanceStatus)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {guest.checkedInAt ? formatDateTime(guest.checkedInAt) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="text-xs text-gray-500">
        This report is generated from guest and attendance records and is read-only. It cannot be
        edited manually.
      </p>
    </div>
  );
}
