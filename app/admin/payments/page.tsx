"use client";

import { useEffect, useState } from "react";

interface Payment {
  id: string;
  amount: number | string;
  status: string;
  user?: { name?: string; email?: string };
  event?: { title?: string; status?: string };
}

export default function AdminPaymentsPage() {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchPayments();
  }, []);

  async function fetchPayments() {
    try {
      const res = await fetch("/api/admin/payments", { credentials: "include" });
      const data = await res.json();
      if (Array.isArray(data)) {
        setPayments(data);
        setError("");
      } else if (!res.ok) {
        setError(data.error || "Failed to load payments");
      }
    } catch {
      setError("Failed to load payments");
    } finally {
      setLoading(false);
    }
  }

  async function updatePayment(paymentId: string, status: "VERIFIED" | "REJECTED") {
    const rejectionReason = status === "REJECTED" ? window.prompt("Reason for rejection:") : undefined;
    if (status === "REJECTED" && !rejectionReason) return;
    const res = await fetch("/api/admin/payments", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paymentId, status, rejectionReason }),
    });
    if (res.ok) fetchPayments();
  }

  async function updateEvent(paymentId: string, eventAction: "AUTHORIZED" | "SUSPENDED") {
    const res = await fetch("/api/admin/payments", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paymentId, eventAction }),
    });
    if (res.ok) fetchPayments();
  }

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
      <div className="mb-6">
        <h2 className="text-lg font-bold text-gray-900">Payment review</h2>
        <p className="mt-1 text-sm text-gray-500">Verify submitted payments before authorizing events.</p>
      </div>

      {error && (
        <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p>
      )}

      {loading ? (
        <p className="rounded-lg border border-dashed border-gray-200 bg-gray-50 p-8 text-center text-sm text-gray-500">
          Loading payments...
        </p>
      ) : payments.length === 0 ? (
        <p className="rounded-lg border border-dashed border-gray-200 bg-gray-50 p-8 text-center text-sm text-gray-500">
          No payment records found.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-xs uppercase tracking-wider text-gray-500">
                <th className="px-3 py-3 font-semibold">Client</th>
                <th className="px-3 py-3 font-semibold">Event</th>
                <th className="px-3 py-3 font-semibold">Amount</th>
                <th className="px-3 py-3 font-semibold">Status</th>
                <th className="px-3 py-3 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((payment) => (
                <tr key={payment.id} className="border-b border-gray-100 last:border-0">
                  <td className="px-3 py-4 font-semibold text-gray-800">
                    {payment.user?.name || payment.user?.email || "Unknown"}
                  </td>
                  <td className="px-3 py-4 text-gray-600">{payment.event?.title || "Event"}</td>
                  <td className="px-3 py-4 font-semibold text-gray-800">
                    {Number(payment.amount).toLocaleString()} TSh
                  </td>
                  <td className="px-3 py-4">
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-bold ${
                        payment.status === "VERIFIED"
                          ? "bg-emerald-100 text-emerald-700"
                          : payment.status === "REJECTED"
                            ? "bg-red-100 text-red-700"
                            : "bg-amber-100 text-amber-700"
                      }`}
                    >
                      {payment.status}
                    </span>
                  </td>
                  <td className="px-3 py-4">
                    <div className="flex flex-wrap gap-2">
                      {payment.status === "SUBMITTED" && (
                        <>
                          <button
                            onClick={() => updatePayment(payment.id, "VERIFIED")}
                            className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700"
                          >
                            Verify
                          </button>
                          <button
                            onClick={() => updatePayment(payment.id, "REJECTED")}
                            className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-red-700"
                          >
                            Reject
                          </button>
                        </>
                      )}
                      {payment.status === "VERIFIED" && payment.event?.status !== "AUTHORIZED" && (
                        <button
                          onClick={() => updateEvent(payment.id, "AUTHORIZED")}
                          className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-blue-700"
                        >
                          Authorize event
                        </button>
                      )}
                      {payment.event?.status === "AUTHORIZED" && (
                        <button
                          onClick={() => updateEvent(payment.id, "SUSPENDED")}
                          className="rounded-md bg-violet-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-violet-700"
                        >
                          Suspend event
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
