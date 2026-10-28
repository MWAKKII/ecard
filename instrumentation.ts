import type { Instrumentation } from "next";
import { logError } from "@/lib/logger";

/**
 * Next.js server-error hook. This catches unhandled errors from route
 * handlers, server components, server actions and the proxy that would
 * otherwise only appear as a generic 500 response.
 *
 * The query string is removed before logging so guest QR tokens and other
 * request parameters never enter the log stream.
 */
export const onRequestError: Instrumentation.onRequestError = async (
  error,
  request,
  context,
) => {
  logError("Unhandled server request error", error, {
    method: request.method,
    path: request.path.split("?")[0],
    routerKind: context.routerKind,
    routePath: context.routePath,
    routeType: context.routeType,
  });
};
