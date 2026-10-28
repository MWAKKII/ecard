/** Shared report shapes (safe to import from client components). */

export const REPORT_CARD_TYPES = ["STANDARD", "PREMIUM"] as const;
export type ReportCardType = (typeof REPORT_CARD_TYPES)[number];

export interface ReportGuest {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  cardType: ReportCardType;
  attendanceStatus: string;
  attended: boolean;
  checkedInAt: string | null;
}

export interface CardTypeBreakdown {
  cardType: ReportCardType;
  totalGuests: number;
  attended: number;
  notAttended: number;
  attendancePercent: number;
  nonAttendancePercent: number;
}

export interface EventReport {
  event: {
    id: string;
    title: string;
    type: string;
    status: string;
    coupleNames: string | null;
    location: string | null;
    startsAt: string;
    endsAt: string | null;
    reportAvailableAt: string;
  };
  generatedAt: string;
  totals: {
    totalGuests: number;
    attended: number;
    notAttended: number;
    attendancePercent: number;
    nonAttendancePercent: number;
  };
  byCardType: CardTypeBreakdown[];
  guests: ReportGuest[];
  readOnly: true;
}
