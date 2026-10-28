import { prisma } from "@/lib/prisma";
import {
  REPORT_CARD_TYPES,
  type EventReport,
  type ReportCardType,
  type ReportGuest,
} from "@/lib/report-types";

/**
 * Read-only post-event reporting (Step 12).
 *
 * The report is calculated exclusively from Event, Guest and Attendance rows.
 * There is intentionally no write path: the report can be viewed and exported,
 * but never edited.
 */

export type LoadReportResult =
  | { ok: true; report: EventReport }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "not_available"; availableAt: string };

/** Rounds to one decimal place. */
function roundOneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}

export function percentage(part: number, total: number): number {
  return total > 0 ? roundOneDecimal((part / total) * 100) : 0;
}

/**
 * The report unlocks after the event has ended. Events do not currently have
 * an end time in the UI, so an event without endsAt unlocks at the end of its
 * event day rather than at its start time.
 */
export function reportAvailableAt(event: {
  startsAt: Date;
  endsAt: Date | null;
}): Date {
  if (event.endsAt) return new Date(event.endsAt);

  const endOfEventDay = new Date(event.startsAt);
  endOfEventDay.setHours(23, 59, 59, 999);
  return endOfEventDay;
}

export function isReportAvailable(
  event: { startsAt: Date; endsAt: Date | null },
  now: Date = new Date(),
): boolean {
  return reportAvailableAt(event).getTime() <= now.getTime();
}

/**
 * Loads one event's report in a single query. Ownership is part of the query
 * so a client can never read another organizer's report.
 */
export async function loadEventReport(
  eventId: string,
  ownerId: string,
): Promise<LoadReportResult> {
  const event = await prisma.event.findFirst({
    where: { id: eventId, ownerId },
    select: {
      id: true,
      title: true,
      type: true,
      status: true,
      coupleNames: true,
      location: true,
      startsAt: true,
      endsAt: true,
      guests: {
        select: {
          id: true,
          fullName: true,
          email: true,
          phone: true,
          cardType: true,
          attendances: {
            take: 1,
            select: {
              status: true,
              checkedInAt: true,
            },
          },
        },
        orderBy: { fullName: "asc" },
      },
    },
  });

  if (!event) return { ok: false, reason: "not_found" };

  const availableAt = reportAvailableAt(event);
  if (availableAt.getTime() > Date.now()) {
    return {
      ok: false,
      reason: "not_available",
      availableAt: availableAt.toISOString(),
    };
  }

  const guests: ReportGuest[] = event.guests.map((guest) => {
    const attendance = guest.attendances[0] ?? null;
    return {
      id: guest.id,
      fullName: guest.fullName,
      email: guest.email,
      phone: guest.phone,
      cardType: guest.cardType as ReportCardType,
      attendanceStatus: attendance?.status ?? "REGISTERED",
      attended: attendance?.status === "CHECKED_IN",
      checkedInAt: attendance?.checkedInAt?.toISOString() ?? null,
    };
  });

  const totalGuests = guests.length;
  const attended = guests.filter((guest) => guest.attended).length;
  const notAttended = totalGuests - attended;
  const attendancePercent = percentage(attended, totalGuests);

  const byCardType = REPORT_CARD_TYPES.map((cardType) => {
    const group = guests.filter((guest) => guest.cardType === cardType);
    const groupTotal = group.length;
    const groupAttended = group.filter((guest) => guest.attended).length;
    const groupPercent = percentage(groupAttended, groupTotal);

    return {
      cardType,
      totalGuests: groupTotal,
      attended: groupAttended,
      notAttended: groupTotal - groupAttended,
      attendancePercent: groupPercent,
      nonAttendancePercent:
        groupTotal > 0 ? roundOneDecimal(100 - groupPercent) : 0,
    };
  });

  return {
    ok: true,
    report: {
      event: {
        id: event.id,
        title: event.title,
        type: event.type,
        status: event.status,
        coupleNames: event.coupleNames,
        location: event.location,
        startsAt: event.startsAt.toISOString(),
        endsAt: event.endsAt?.toISOString() ?? null,
        reportAvailableAt: availableAt.toISOString(),
      },
      generatedAt: new Date().toISOString(),
      totals: {
        totalGuests,
        attended,
        notAttended,
        attendancePercent,
        nonAttendancePercent:
          totalGuests > 0 ? roundOneDecimal(100 - attendancePercent) : 0,
      },
      byCardType,
      guests,
      readOnly: true,
    },
  };
}
