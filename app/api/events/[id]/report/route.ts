import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { loadEventReport } from "@/lib/reports";
import {
  buildReportCsv,
  buildReportPdf,
} from "@/lib/report-export";
import { reportFilename } from "@/lib/report-format";
import { takeRateLimit, rateLimitResponse } from "@/lib/rate-limit";

type RouteContext = { params: Promise<{ id: string }> };

// PDFKit uses Node streams and standard font metrics from the package.
export const runtime = "nodejs";

const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};

/**
 * Read-only post-event report (Step 12).
 *
 * GET                         → JSON report
 * GET ?format=csv             → Excel-compatible CSV
 * GET ?format=pdf             → downloadable PDF
 *
 * There is deliberately no POST/PATCH/DELETE handler: report contents cannot
 * be edited. Everything is recalculated from the database for each request.
 */
export async function GET(request: Request, { params }: RouteContext) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401, headers: NO_STORE_HEADERS },
      );
    }

    const reportLimit = takeRateLimit(`report:generate:${session.userId}`, 20, 60 * 1000);
    if (!reportLimit.allowed) {
      return rateLimitResponse(
        reportLimit,
        "Too many report requests. Try again later.",
        NO_STORE_HEADERS,
      );
    }

    const { id: eventId } = await params;
    const result = await loadEventReport(eventId, session.userId);

    if (!result.ok) {
      if (result.reason === "not_found") {
        return NextResponse.json(
          { error: "Event not found" },
          { status: 404, headers: NO_STORE_HEADERS },
        );
      }

      return NextResponse.json(
        {
          error: "The report becomes available after the event date has passed.",
          availableAt: result.availableAt,
        },
        { status: 403, headers: NO_STORE_HEADERS },
      );
    }

    const report = result.report;
    const format = new URL(request.url).searchParams.get("format")?.toLowerCase() ?? "json";

    if (format === "json") {
      return NextResponse.json(report, { headers: NO_STORE_HEADERS });
    }

    if (format === "csv") {
      const csv = Buffer.from(buildReportCsv(report), "utf8");
      return new NextResponse(new Uint8Array(csv), {
        status: 200,
        headers: {
          ...NO_STORE_HEADERS,
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Length": String(csv.length),
          "Content-Disposition": `attachment; filename="${reportFilename(report.event.title, "csv")}"`,
        },
      });
    }

    if (format === "pdf") {
      const pdf = await buildReportPdf(report);
      return new NextResponse(new Uint8Array(pdf), {
        status: 200,
        headers: {
          ...NO_STORE_HEADERS,
          "Content-Type": "application/pdf",
          "Content-Length": String(pdf.length),
          "Content-Disposition": `attachment; filename="${reportFilename(report.event.title, "pdf")}"`,
        },
      });
    }

    return NextResponse.json(
      { error: "Unsupported report format. Use json, csv or pdf." },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    console.error("Report generation error:", error);
    return NextResponse.json(
      { error: "Unable to generate the report" },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
