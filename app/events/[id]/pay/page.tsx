"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";

interface PaymentRecord {
  status: string;
  rejectionReason?: string | null;
}

interface EventData {
  title?: string;
  quotedAmount?: number | string;
  paymentInstructions?: string | null;
  pricingTier?: { name?: string; price?: number };
  payments?: PaymentRecord[];
}

export default function CheckoutPage() {
  const params = useParams();
  const eventId = params.id;
  const router = useRouter();

  const [eventData, setEventData] = useState<EventData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [paymentReference, setPaymentReference] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("VodaLipa");

  // Fetch event details and pricing tier info
  useEffect(() => {
    async function fetchEvent() {
      try {
        const res = await fetch(`/api/events/${eventId}`, { credentials: "include" });
        if (res.ok) {
          const data = await res.json();
          setEventData(data);
        }
      } catch (err) {
        console.error("Failed to fetch event data", err);
      }
    }
    if (eventId) fetchEvent();
  }, [eventId]);

  async function handlePayment(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch(`/api/events/${eventId}/pay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          paymentReference,
          paymentMethod,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Payment processing failed");
        setLoading(false);
      } else {
        router.push("/dashboard");
      }
    } catch {
      setError("Network error. Please try again.");
      setLoading(false);
    }
  }

  const tier = eventData?.pricingTier;

  return (
    <div style={{
      minHeight: "100vh",
      background: "linear-gradient(135deg, #0f172a 0%, #1e3a8a 50%, #3b82f6 100%)",
      fontFamily: "sans-serif",
      padding: "40px 20px",
      display: "flex",
      alignItems: "center",
      justifyContent: "center"
    }}>
      <style jsx global>{`
        @keyframes scaleUp {
          from { opacity: 0; transform: translateY(20px) scale(0.98); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        .animate-checkout {
          animation: scaleUp 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
      `}</style>

      <div className="animate-checkout" style={{
        background: "rgba(255, 255, 255, 0.95)",
        backdropFilter: "blur(12px)",
        padding: "40px",
        borderRadius: "16px",
        boxShadow: "0 20px 40px rgba(0,0,0,0.3)",
        width: "100%",
        maxWidth: "500px"
      }}>
        <div style={{ textAlign: "center", marginBottom: "25px" }}>
          <span style={{ background: "#dbeafe", color: "#1d4ed8", padding: "6px 14px", borderRadius: "20px", fontSize: "12px", fontWeight: "700", textTransform: "uppercase" }}>
            Step 8: Secure Checkout
          </span>
          <h2 style={{ margin: "15px 0 5px 0", color: "#0f172a", fontSize: "26px", fontWeight: "800" }}>
            Complete Your Booking
          </h2>
          <p style={{ margin: 0, color: "#64748b", fontSize: "14px" }}>
            Review your order summary and finalize payment.
          </p>
        </div>

        {error && (
          <div style={{ background: "#fee2e2", color: "#b91c1c", padding: "12px", borderRadius: "8px", marginBottom: "20px", fontSize: "14px", textAlign: "center", fontWeight: "600" }}>
            {error}
          </div>
        )}

        {/* Order Summary Box */}
        <div style={{ background: "#f8fafc", border: "1px solid #cbd5e1", borderRadius: "10px", padding: "20px", marginBottom: "25px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "10px" }}>
            <span style={{ color: "#64748b", fontSize: "14px" }}>Event Title:</span>
            <span style={{ color: "#0f172a", fontWeight: "700", fontSize: "14px" }}>{eventData?.title || "Loading..."}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "10px" }}>
            <span style={{ color: "#64748b", fontSize: "14px" }}>Selected Tier:</span>
            <span style={{ color: "#2563eb", fontWeight: "700", fontSize: "14px" }}>{tier?.name || "Standard Tier"}</span>
          </div>
          <div style={{ borderTop: "1px solid #e2e8f0", marginTop: "12px", paddingTop: "12px", display: "flex", justifyContent: "space-between" }}>
            <span style={{ color: "#0f172a", fontWeight: "800", fontSize: "16px" }}>Total Due:</span>
            <span style={{ color: "#2563eb", fontWeight: "800", fontSize: "20px" }}>{Number(eventData?.quotedAmount || tier?.price || 0).toLocaleString()} TSh</span>
          </div>
        </div>

        <div style={{ background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: "10px", padding: "16px", marginBottom: "16px", color: "#1e3a8a", fontSize: "14px" }}>
          <strong>Payment status:</strong> {eventData?.payments?.[0]?.status || "PENDING"}
          <p style={{ margin: "8px 0 0" }}>Complete payment using one of the methods below, then submit the reference message for admin review.</p>
          {eventData?.payments?.[0]?.rejectionReason && <p style={{ color: "#b91c1c", margin: "8px 0 0" }}>Reason: {eventData.payments[0].rejectionReason}</p>}
        </div>

        <div style={{ background: "#0f172a", color: "#ffffff", borderRadius: "10px", padding: "18px 20px", marginBottom: "25px", fontSize: "15px", lineHeight: 1.8 }}>
          <strong style={{ display: "block", color: "#93c5fd", marginBottom: "6px" }}>Payment Methods</strong>
          <div>VodaLipa -22334567</div>
          <div>AirtelLipa - 138457098</div>
          <div>Mpesa - 0794786406</div>
        </div>

        {/* Payment Form */}
        <form onSubmit={handlePayment} style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
          <div>
            <label style={{ display: "block", marginBottom: "8px", color: "#334155", fontSize: "14px", fontWeight: "700" }}>
              Method Used
            </label>
            <select
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value)}
              required
              style={{ width: "100%", padding: "12px", borderRadius: "8px", border: "1px solid #cbd5e1", background: "#f8fafc", color: "#0f172a", fontSize: "14px", boxSizing: "border-box" }}
            >
              <option value="VodaLipa">VodaLipa</option>
              <option value="AirtelLipa">AirtelLipa</option>
              <option value="Mpesa">Mpesa</option>
            </select>
          </div>

          <div>
            <label style={{ display: "block", marginBottom: "8px", color: "#334155", fontSize: "14px", fontWeight: "700" }}>
              Reference Message
            </label>
            <input 
              type="text" 
              value={paymentReference}
              onChange={(e) => setPaymentReference(e.target.value)}
              placeholder="Enter the payment reference message" 
              required
              style={{ width: "100%", padding: "12px", borderRadius: "8px", border: "1px solid #cbd5e1", background: "#f8fafc", color: "#0f172a", fontSize: "14px", boxSizing: "border-box" }}
            />
          </div>

          <button 
            type="submit" 
            disabled={loading}
            style={{ 
              marginTop: "10px", 
              padding: "16px", 
              background: loading ? "#93c5fd" : "linear-gradient(135deg, #2563eb 0%, #1e40af 100%)", 
              color: "#ffffff", 
              border: "none", 
              borderRadius: "8px", 
              cursor: loading ? "not-allowed" : "pointer", 
              fontWeight: "bold", 
              fontSize: "16px", 
              boxShadow: "0 4px 12px rgba(37, 99, 235, 0.4)",
              transition: "filter 0.2s ease"
            }}
          >
            {loading ? "Submitting for Review..." : `Submit ${Number(eventData?.quotedAmount || tier?.price || 0).toLocaleString()} TSh Payment`}
          </button>
        </form>
      </div>
    </div>
  );
}