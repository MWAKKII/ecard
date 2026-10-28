/**
 * Minimal structured logger for server-side production diagnostics.
 *
 * Vercel captures stdout/stderr from functions and makes it searchable in the
 * deployment log viewer. Keeping one JSON object per line also makes a log
 * drain (Datadog, Better Stack, etc.) useful without adding a vendor SDK.
 *
 * Never pass request bodies, cookies, passwords, connection strings, API keys
 * or other secrets in `context`.
 */

type LogLevel = "info" | "warn" | "error";

type LogContext = Record<string, unknown>;

function errorDetails(error: unknown): LogContext {
  if (error instanceof Error) {
    const details: LogContext = {
      name: error.name,
      message: error.message,
    };
    if (error.stack) {
      details.stack = error.stack.split("\n").slice(0, 12).join("\n");
    }
    if ("digest" in error && typeof error.digest === "string") {
      details.digest = error.digest;
    }
    return details;
  }
  return { message: typeof error === "string" ? error.slice(0, 1000) : "Unknown error" };
}

function write(level: LogLevel, message: string, context: LogContext): void {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    service: "ecard",
    message,
    ...context,
  };

  let line: string;
  try {
    line = JSON.stringify(entry);
  } catch {
    line = JSON.stringify({
      timestamp: entry.timestamp,
      level,
      service: "ecard",
      message,
      contextError: "Log context could not be serialized",
    });
  }

  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export function logInfo(message: string, context: LogContext = {}): void {
  write("info", message, context);
}

export function logWarn(message: string, context: LogContext = {}): void {
  write("warn", message, context);
}

export function logError(message: string, error: unknown, context: LogContext = {}): void {
  write("error", message, { ...context, error: errorDetails(error) });
}
