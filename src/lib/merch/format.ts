import type { MerchOrderStatus, MerchPaymentStatus } from "@/types/domain";

export function formatCents(cents: number) {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

/** Order lifecycle, in order. Cancelled can happen from any step before shipping. */
export const ORDER_STEPS: { value: MerchOrderStatus; label: string; next?: string }[] = [
  { value: "requested", label: "Requested", next: "Approve" },
  { value: "approved", label: "Approved", next: "Mark sent to vendor" },
  { value: "sent_to_vendor", label: "With vendor", next: "Mark shipped" },
  { value: "shipped", label: "Shipped", next: "Mark delivered" },
  { value: "delivered", label: "Delivered" },
  { value: "cancelled", label: "Cancelled" },
];

export function nextStatus(status: MerchOrderStatus): MerchOrderStatus | null {
  const order: MerchOrderStatus[] = ["requested", "approved", "sent_to_vendor", "shipped", "delivered"];
  const i = order.indexOf(status);
  return i === -1 || i === order.length - 1 ? null : order[i + 1];
}

export const PAYMENT_OPTIONS: { value: MerchPaymentStatus; label: string }[] = [
  { value: "unpaid", label: "Unpaid" },
  { value: "paid", label: "Paid" },
  { value: "payroll_deduction", label: "Payroll deduction" },
  { value: "company_paid", label: "Company paid" },
];
