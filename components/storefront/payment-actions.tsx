"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function PaymentActions({ orderId, orderNumber, retry = false }: { orderId: string; orderNumber: string; retry?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function pay() {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/payments/order", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ orderId }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "We couldn't initialize payment.");
      const Razorpay = await loadRazorpay();
      const checkout = new Razorpay({ key: body.keyId, amount: Math.round(Number(body.order.amount) * 100), currency: body.order.currency, name: "Nuvicart", description: `Order ${orderNumber}`, order_id: body.order.provider_order_id, handler: async (result: { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string }) => {
        const verification = await fetch("/api/payments/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ orderId, ...result }) });
        const verificationBody = await verification.json().catch(() => ({}));
        if (!verificationBody.verified) throw new Error(verificationBody.error ?? "Payment could not be verified.");
        router.refresh();
      }, modal: { ondismiss: () => setMessage("Checkout was closed. Your order is still unpaid; you can retry whenever you're ready.") }, theme: { color: "#111827" } });
      checkout.open();
    } catch (error) { setMessage(error instanceof Error ? error.message : "We couldn't start payment."); }
    finally { setBusy(false); }
  }

  return <div className="mt-5"><button type="button" onClick={() => void pay()} disabled={busy} className="inline-flex rounded-full bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50">{busy ? "Preparing payment…" : retry ? "Retry payment" : "Pay now"}</button>{message && <p role="alert" className="mt-3 text-xs text-error">{message}</p>}</div>;
}

function loadRazorpay(): Promise<any> {
  if (typeof window !== "undefined" && (window as any).Razorpay) return Promise.resolve((window as any).Razorpay);
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[src="https://checkout.razorpay.com/v1/checkout.js"]');
    if (existing) { existing.addEventListener("load", () => resolve((window as any).Razorpay)); existing.addEventListener("error", () => reject(new Error("Razorpay Checkout could not be loaded."))); return; }
    const script = document.createElement("script"); script.src = "https://checkout.razorpay.com/v1/checkout.js"; script.async = true; script.onload = () => resolve((window as any).Razorpay); script.onerror = () => reject(new Error("Razorpay Checkout could not be loaded.")); document.body.appendChild(script);
  });
}

declare global { interface Window { Razorpay?: any } }
