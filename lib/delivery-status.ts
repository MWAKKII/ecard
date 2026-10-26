/** Shared presentation values for the WhatsApp card-delivery state. */
export type DeliveryStatusValue = "NOT_SENT" | "NOT_CONFIGURED" | "SENT" | "FAILED";

export const DELIVERY_STATUS_LABEL: Record<DeliveryStatusValue, string> = {
  NOT_SENT: "Not sent",
  NOT_CONFIGURED: "Not configured",
  SENT: "Sent",
  FAILED: "Failed",
};

export const DELIVERY_STATUS_BADGE: Record<DeliveryStatusValue, string> = {
  NOT_SENT: "bg-gray-100 text-gray-600",
  NOT_CONFIGURED: "bg-amber-100 text-amber-700",
  SENT: "bg-emerald-100 text-emerald-700",
  FAILED: "bg-red-100 text-red-700",
};
