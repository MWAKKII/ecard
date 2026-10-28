/** Pure report formatting helpers shared by the server exports and the UI. */

const ATTENDANCE_LABELS: Record<string, string> = {
  REGISTERED: "Registered",
  CHECKED_IN: "Checked in",
  NO_SHOW: "No show",
  LEFT: "Left",
};

const CARD_TYPE_LABELS: Record<string, string> = {
  STANDARD: "Standard",
  PREMIUM: "Premium",
};

function titleCase(value: string): string {
  return value
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

export function attendanceLabel(status: string): string {
  return ATTENDANCE_LABELS[status] ?? titleCase(status);
}

export function cardTypeLabel(cardType: string): string {
  return CARD_TYPE_LABELS[cardType] ?? titleCase(cardType);
}

export function formatDateTime(value: string | Date | null): string {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function formatPercent(value: number): string {
  return `${value.toFixed(value % 1 === 0 ? 0 : 1)}%`;
}

export function reportFilename(title: string, extension: "pdf" | "csv"): string {
  const base =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)+/g, "")
      .slice(0, 60) || "event";
  return `${base}-report.${extension}`;
}
