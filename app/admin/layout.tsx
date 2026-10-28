import { redirect } from "next/navigation";
import AdminShell from "@/components/admin-shell";
import { requireAdmin } from "@/lib/session";

/**
 * Server-side admin boundary. The proxy only decodes the JWT for a cheap page
 * redirect; this layout re-checks role and account status against the database
 * on every admin request, so a stale token cannot keep page access after a
 * demotion/suspension.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireAdmin();
  if (!admin) redirect("/dashboard");

  return <AdminShell>{children}</AdminShell>;
}
