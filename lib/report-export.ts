import PDFDocument from "pdfkit";
import type { EventReport } from "@/lib/report-types";
import {
  attendanceLabel,
  cardTypeLabel,
  formatDateTime,
  formatPercent,
} from "@/lib/report-format";

/**
 * Server-only report exports. PDF and CSV are generated from the same
 * EventReport object used by the JSON view, so every output is derived from
 * the database and stays consistent.
 */

function csvEscape(value: string | number | null | undefined): string {
  let text = value === null || value === undefined ? "" : String(value);

  // Formula-injection defence: Excel/Sheets can execute a cell that starts
  // with =, +, -, @, tab or carriage return. Prefix those strings with an
  // apostrophe so the export remains data, even if a guest name is hostile.
  if (typeof value === "string" && /^[\s]*[=+\-@\t\r]/.test(text)) {
    text = `'${text}`;
  }

  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function csvRow(values: (string | number | null | undefined)[]): string {
  return values.map(csvEscape).join(",");
}

/** RFC-4180-compatible CSV with a UTF-8 BOM so Excel opens it correctly. */
export function buildReportCsv(report: EventReport): string {
  const lines: string[] = [];
  const { event, totals } = report;

  lines.push(csvRow(["Event", event.title]));
  lines.push(csvRow(["Event date", formatDateTime(event.startsAt)]));
  if (event.location) lines.push(csvRow(["Location", event.location]));
  lines.push(csvRow(["Report generated", formatDateTime(report.generatedAt)]));
  lines.push("");
  lines.push(csvRow(["Summary"]));
  lines.push(csvRow(["Total guests", totals.totalGuests]));
  lines.push(csvRow(["Attended", totals.attended]));
  lines.push(csvRow(["Not attended", totals.notAttended]));
  lines.push(csvRow(["Attendance %", formatPercent(totals.attendancePercent)]));
  lines.push(
    csvRow(["Non-attendance %", formatPercent(totals.nonAttendancePercent)]),
  );
  lines.push("");
  lines.push(csvRow(["Card type breakdown"]));
  lines.push(
    csvRow([
      "Card type",
      "Total guests",
      "Attended",
      "Not attended",
      "Attendance %",
      "Non-attendance %",
    ]),
  );
  for (const row of report.byCardType) {
    lines.push(
      csvRow([
        cardTypeLabel(row.cardType),
        row.totalGuests,
        row.attended,
        row.notAttended,
        formatPercent(row.attendancePercent),
        formatPercent(row.nonAttendancePercent),
      ]),
    );
  }
  lines.push("");
  lines.push(csvRow(["Guest list"]));
  lines.push(
    csvRow([
      "Guest name",
      "Email",
      "Phone",
      "Card type",
      "Attendance status",
      "Attended",
      "Scan time (ISO)",
    ]),
  );
  for (const guest of report.guests) {
    lines.push(
      csvRow([
        guest.fullName,
        guest.email,
        guest.phone,
        cardTypeLabel(guest.cardType),
        attendanceLabel(guest.attendanceStatus),
        guest.attended ? "Yes" : "No",
        guest.checkedInAt,
      ]),
    );
  }

  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

/** Standard-font PDFKit only supports WinAnsi characters. */
function pdfText(value: string | null | undefined): string {
  return (value ?? "")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, "?");
}

function drawReportHeader(
  doc: PDFKit.PDFDocument,
  report: EventReport,
  margin: number,
  contentWidth: number,
): number {
  let y = margin;

  doc
    .font("Helvetica-Bold")
    .fontSize(8)
    .fillColor("#2563eb")
    .text("POST-EVENT REPORT", margin, y, { characterSpacing: 1.2 });
  y = doc.y + 4;

  doc
    .font("Helvetica-Bold")
    .fontSize(21)
    .fillColor("#111827")
    .text(pdfText(report.event.title), margin, y, { width: contentWidth });
  y = doc.y + 4;

  const dateLine = formatDateTime(report.event.startsAt);
  doc
    .font("Helvetica")
    .fontSize(9)
    .fillColor("#4b5563")
    .text(
      `${dateLine}${report.event.location ? ` · ${pdfText(report.event.location)}` : ""}`,
      margin,
      y,
      { width: contentWidth },
    );
  y = doc.y + 2;

  doc
    .font("Helvetica")
    .fontSize(8)
    .fillColor("#6b7280")
    .text(
      `Generated ${formatDateTime(report.generatedAt)} · Read-only, derived from database records`,
      margin,
      y,
      { width: contentWidth },
    );
  y = doc.y + 12;

  doc
    .moveTo(margin, y)
    .lineTo(margin + contentWidth, y)
    .strokeColor("#e5e7eb")
    .lineWidth(1)
    .stroke();

  return y + 16;
}

function drawSummaryBoxes(
  doc: PDFKit.PDFDocument,
  report: EventReport,
  margin: number,
  contentWidth: number,
  y: number,
): number {
  const gap = 8;
  const boxWidth = (contentWidth - gap * 4) / 5;
  const boxHeight = 48;
  const metrics = [
    { label: "Total guests", value: String(report.totals.totalGuests), color: "#111827" },
    { label: "Attended", value: String(report.totals.attended), color: "#047857" },
    { label: "Not attended", value: String(report.totals.notAttended), color: "#b45309" },
    { label: "Attendance", value: formatPercent(report.totals.attendancePercent), color: "#1d4ed8" },
    { label: "Non-attendance", value: formatPercent(report.totals.nonAttendancePercent), color: "#be123c" },
  ];

  metrics.forEach((metric, index) => {
    const x = margin + index * (boxWidth + gap);
    doc
      .roundedRect(x, y, boxWidth, boxHeight, 6)
      .fillAndStroke("#f9fafb", "#e5e7eb");
    doc
      .font("Helvetica-Bold")
      .fontSize(6.5)
      .fillColor("#6b7280")
      .text(pdfText(metric.label).toUpperCase(), x + 8, y + 8, {
        width: boxWidth - 16,
      });
    doc
      .font("Helvetica-Bold")
      .fontSize(15)
      .fillColor(metric.color)
      .text(metric.value, x + 8, y + 22, { width: boxWidth - 16 });
  });

  return y + boxHeight + 18;
}

function drawTableHeader(
  doc: PDFKit.PDFDocument,
  columns: { label: string; width: number; align?: "left" | "right" }[],
  margin: number,
  y: number,
): number {
  const totalWidth = columns.reduce((sum, column) => sum + column.width, 0);
  doc.rect(margin, y, totalWidth, 20).fill("#f3f4f6");
  let x = margin;
  for (const column of columns) {
    doc
      .font("Helvetica-Bold")
      .fontSize(7.5)
      .fillColor("#4b5563")
      .text(pdfText(column.label), x + 4, y + 6, {
        width: column.width - 8,
        align: column.align ?? "left",
        lineBreak: false,
        ellipsis: true,
      });
    x += column.width;
  }
  return y + 20;
}

function drawTableRow(
  doc: PDFKit.PDFDocument,
  columns: { width: number; value: string; color?: string; align?: "left" | "right" }[],
  margin: number,
  y: number,
  rowHeight: number,
  shade: boolean,
): number {
  const totalWidth = columns.reduce((sum, column) => sum + column.width, 0);
  if (shade) {
    doc.rect(margin, y, totalWidth, rowHeight).fill("#fafafa");
  }
  let x = margin;
  for (const column of columns) {
    doc
      .font("Helvetica")
      .fontSize(8)
      .fillColor(column.color ?? "#374151")
      .text(pdfText(column.value), x + 4, y + 7, {
        width: column.width - 8,
        align: column.align ?? "left",
        lineBreak: false,
        ellipsis: true,
      });
    x += column.width;
  }
  doc
    .moveTo(margin, y + rowHeight)
    .lineTo(margin + totalWidth, y + rowHeight)
    .strokeColor("#f3f4f6")
    .lineWidth(0.5)
    .stroke();
  return y + rowHeight;
}

function drawCardTypeBreakdown(
  doc: PDFKit.PDFDocument,
  report: EventReport,
  margin: number,
  y: number,
): number {
  if (y + 100 > doc.page.height - 60) {
    doc.addPage();
    y = margin;
  }

  doc
    .font("Helvetica-Bold")
    .fontSize(12)
    .fillColor("#111827")
    .text("Card type breakdown", margin, y);
  y = doc.y + 6;

  const columns = [
    { label: "Card type", width: 120 },
    { label: "Total", width: 70, align: "right" as const },
    { label: "Attended", width: 70, align: "right" as const },
    { label: "Not attended", width: 80, align: "right" as const },
    { label: "Attendance %", width: 87, align: "right" as const },
    { label: "Non-attendance %", width: 88, align: "right" as const },
  ];
  y = drawTableHeader(doc, columns, margin, y);

  report.byCardType.forEach((row, index) => {
    y = drawTableRow(
      doc,
      [
        { width: 120, value: cardTypeLabel(row.cardType) },
        { width: 70, value: String(row.totalGuests), align: "right" },
        { width: 70, value: String(row.attended), align: "right" },
        { width: 80, value: String(row.notAttended), align: "right" },
        { width: 87, value: formatPercent(row.attendancePercent), align: "right" },
        {
          width: 88,
          value: formatPercent(row.nonAttendancePercent),
          align: "right",
        },
      ],
      margin,
      y,
      20,
      index % 2 === 1,
    );
  });

  return y + 18;
}

function drawGuestList(
  doc: PDFKit.PDFDocument,
  report: EventReport,
  margin: number,
  contentWidth: number,
  y: number,
): number {
  const pageBottom = doc.page.height - 60;
  if (y + 60 > pageBottom) {
    doc.addPage();
    y = margin;
  }

  doc
    .font("Helvetica-Bold")
    .fontSize(12)
    .fillColor("#111827")
    .text("Full guest list", margin, y);
  y = doc.y + 6;

  const guestColumns = [
    { label: "#", width: 24 },
    { label: "Guest", width: 145 },
    { label: "Phone", width: 92 },
    { label: "Card", width: 62 },
    { label: "Attendance", width: 88 },
    { label: "Scan time", width: 104 },
  ];

  y = drawTableHeader(doc, guestColumns, margin, y);

  if (report.guests.length === 0) {
    doc
      .font("Helvetica")
      .fontSize(9)
      .fillColor("#6b7280")
      .text("No guests were registered for this event.", margin + 4, y + 8, {
        width: contentWidth - 8,
      });
    return y + 28;
  }

  report.guests.forEach((guest, index) => {
    if (y + 22 > pageBottom) {
      doc.addPage();
      y = margin;
      doc
        .font("Helvetica-Bold")
        .fontSize(12)
        .fillColor("#111827")
        .text("Full guest list (continued)", margin, y);
      y = doc.y + 6;
      y = drawTableHeader(doc, guestColumns, margin, y);
    }

    y = drawTableRow(
      doc,
      [
        { width: 24, value: String(index + 1), color: "#9ca3af" },
        { width: 145, value: guest.fullName, color: "#111827" },
        { width: 92, value: guest.phone || "—" },
        { width: 62, value: cardTypeLabel(guest.cardType) },
        {
          width: 88,
          value: attendanceLabel(guest.attendanceStatus),
          color: guest.attended ? "#047857" : "#6b7280",
        },
        { width: 104, value: guest.checkedInAt ? formatDateTime(guest.checkedInAt) : "—" },
      ],
      margin,
      y,
      22,
      index % 2 === 1,
    );
  });

  return y + 14;
}

export async function buildReportPdf(report: EventReport): Promise<Buffer> {
  const doc = new PDFDocument({
    size: "A4",
    margin: 40,
    bufferPages: true,
  });

  const chunks: Buffer[] = [];
  const finished = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const margin = 40;
  const contentWidth = doc.page.width - margin * 2;

  let y = drawReportHeader(doc, report, margin, contentWidth);
  y = drawSummaryBoxes(doc, report, margin, contentWidth, y);
  y = drawCardTypeBreakdown(doc, report, margin, y);
  y = drawGuestList(doc, report, margin, contentWidth, y);

  doc
    .font("Helvetica")
    .fontSize(7.5)
    .fillColor("#9ca3af")
    .text(
      "This report is generated from guest and attendance records. It is read-only and cannot be edited manually.",
      margin,
      y,
      { width: contentWidth },
    );

  const range = doc.bufferedPageRange();
  for (let page = range.start; page < range.start + range.count; page++) {
    doc.switchToPage(page);
    doc
      .font("Helvetica")
      .fontSize(7.5)
      .fillColor("#9ca3af")
      .text(`Page ${page + 1} of ${range.count}`, margin, doc.page.height - 32, {
        width: contentWidth,
        align: "right",
      });
  }

  doc.end();
  return finished;
}
