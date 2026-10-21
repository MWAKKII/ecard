import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifySessionToken } from "./lib/jwt";

/**
 * Page-level route protection (Step 4).
 *
 * In Next.js 16 the `middleware` file convention is deprecated and renamed
 * to `proxy`, and the file MUST live in the project root — a file inside
 * `app/` is never loaded by Next, so protection silently does nothing.
 *
 * API routes perform their own server-side authorization (defense in depth);
 * this proxy only handles page redirects.
 */

function loginRedirect(req: NextRequest) {
  const next = encodeURIComponent(req.nextUrl.pathname);
  return NextResponse.redirect(new URL(`/login?next=${next}`, req.url));
}

function homeRedirect(req: NextRequest) {
  return NextResponse.redirect(new URL("/dashboard", req.url));
}

export function proxy(req: NextRequest) {
  const path = req.nextUrl.pathname;
  const token = req.cookies.get("auth_token")?.value;
  const claims = token ? verifySessionToken(token) : null;
  const role = claims?.role;

  // Admin-only areas: admin dashboard, admin tools, developer pages.
  if (path.startsWith("/admin") || path.startsWith("/dev")) {
    if (!role) return loginRedirect(req);
    if (role !== "ADMIN") return homeRedirect(req);
    return NextResponse.next();
  }

  // Client areas: dashboard and event management (any signed-in user).
  if (path.startsWith("/dashboard") || path.startsWith("/events")) {
    if (!role) return loginRedirect(req);
    return NextResponse.next();
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/dashboard/:path*", "/events/:path*", "/dev/:path*"],
};
