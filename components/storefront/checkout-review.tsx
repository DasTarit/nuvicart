"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useCart } from "@/features/cart/store";
import type { CustomerAddress } from "@/features/customer/types";
import type { CheckoutPreview } from "@/features/orders/checkout";

// preview.grandTotal remains the authoritative no-coupon server preview; applied promotions are revalidated server-side before order creation.
function money(value: number) {
  return `₹${value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function CheckoutReview({ preview, addresses }: { preview: CheckoutPreview; addresses: CustomerAddress[] }) {
  const router = useRouter();
  const cart = useCart();
  const defaultAddress = useMemo(() => addresses.find((address) => address.isDefault)?.id ?? addresses[0]?.id ?? "", [addresses]);
  const [addressId, setAddressId] = useState(defaultAddress);
  const [status, setStatus] = useState<"idle" | "submitting" | "error">("idle");
  const [message, setMessage] = useState("");
  const [orderNumber, setOrderNumber] = useState<string | null>(null);
  const [coupon, setCoupon] = useState("");
  const [appliedCoupon, setAppliedCoupon] = useState<{code:string;discountAmount:number;eligibleSubtotal:number} | null>(null);
  const [couponMessage, setCouponMessage] = useState("");
  const [couponBusy, setCouponBusy] = useState(false);
  const [orderId, setOrderId] = useState<string | null>(null);

  async function applyCoupon() {
    const code = coupon.trim();
    if (!code) { setAppliedCoupon(null); setCouponMessage("Enter a coupon code."); return; }
    setCouponBusy(true); setCouponMessage("");
    try {
      const response = await fetch("/api/promotions/validate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body.valid !== true) { setAppliedCoupon(null); setCouponMessage(typeof body.reason === "string" ? body.reason.replaceAll("_", " ").toLowerCase() : "Coupon is not valid for this cart."); return; }
      setAppliedCoupon({ code: body.code, discountAmount: Number(body.discountAmount), eligibleSubtotal: Number(body.eligibleSubtotal) });
      setCoupon(body.code); setCouponMessage("Coupon applied. Final checkout will revalidate it on the server.");
    } catch { setAppliedCoupon(null); setCouponMessage("We couldn't validate that coupon."); } finally { setCouponBusy(false); }
  }

  async function startPayment() {
    if (!addressId) { setStatus("error"); setMessage("Select a delivery address before continuing."); return; }
    setStatus("submitting"); setMessage("");
    try {
      const response = await fetch("/api/orders/checkout", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ addressId, idempotencyKey: crypto.randomUUID(), promotionCode: appliedCoupon?.code ?? (coupon.trim() || null) }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "We couldn't create your order.");
      const createdOrder = body.order as { id?: string; orderNumber?: string };
      if (!createdOrder.id || !createdOrder.orderNumber) throw new Error("Missing order information.");
      setOrderId(createdOrder.id); setOrderNumber(createdOrder.orderNumber);
      const paymentResponse = await fetch("/api/payments/order", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ orderId: createdOrder.id }) });
      const paymentBody = await paymentResponse.json().catch(() => ({}));
      if (!paymentResponse.ok) throw new Error(typeof paymentBody.error === "string" ? paymentBody.error : "We couldn't initialize payment.");
      if (!paymentBody.keyId || !paymentBody.order?.provider_order_id) throw new Error("Payment initialization was incomplete.");
      await openRazorpay(paymentBody.keyId, paymentBody.order.provider_order_id, Number(paymentBody.order.amount) * 100, paymentBody.order.currency, createdOrder.id, createdOrder.orderNumber);
    } catch (error) {
      setStatus("error"); setMessage(error instanceof Error ? error.message : "We couldn't start payment. Please try again.");
    }
  }

  async function openRazorpay(keyId: string, providerOrderId: string, amount: number, currency: string, currentOrderId: string, currentOrderNumber: string) {
    const Razorpay = await loadRazorpay();
    const checkout = new Razorpay({ key: keyId, amount: Math.round(amount), currency, name: "Nuvicart", description: `Order ${currentOrderNumber}`, order_id: providerOrderId, handler: async (response: { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string }) => {
      setMessage("Verifying payment securely…");
      const verify = await fetch("/api/payments/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ orderId: currentOrderId, ...response }) });
      const body = await verify.json().catch(() => ({}));
      if (!verify.ok || !body.verified) { setStatus("error"); setMessage(typeof body.error === "string" ? body.error : "Payment could not be verified."); return; }
      cart.replaceFromCustomerState([]);
      router.push(`/account/orders/${encodeURIComponent(currentOrderNumber)}?paid=1`);
    }, modal: { ondismiss: () => { setStatus("idle"); setMessage("Checkout was closed. Your order is still awaiting payment, so you can retry it from the order page."); } }, theme: { color: "#111827" } });
    checkout.open();
    setStatus("idle");
  }

  function loadRazorpay(): Promise<any> {
    if (typeof window !== "undefined" && (window as any).Razorpay) return Promise.resolve((window as any).Razorpay);
    return new Promise((resolve, reject) => {
      const existing = document.querySelector<HTMLScriptElement>('script[src="https://checkout.razorpay.com/v1/checkout.js"]');
      if (existing) { existing.addEventListener("load", () => resolve((window as any).Razorpay)); existing.addEventListener("error", () => reject(new Error("Razorpay Checkout could not be loaded."))); return; }
      const script = document.createElement("script"); script.src = "https://checkout.razorpay.com/v1/checkout.js"; script.async = true; script.onload = () => resolve((window as any).Razorpay); script.onerror = () => reject(new Error("Razorpay Checkout could not be loaded.")); document.body.appendChild(script);
    });
  }

  if (!preview.items.length) return <div className="rounded-2xl border p-10 text-center"><h2 className="text-xl font-semibold">Your cart is empty.</h2><p className="mt-2 text-sm text-muted">Add something before starting checkout.</p></div>;
  if (!addresses.length) return <div className="rounded-2xl border p-10 text-center"><h2 className="text-xl font-semibold">Add a delivery address first.</h2><p className="mt-2 text-sm text-muted">Checkout uses your saved customer address and never accepts address contents from the browser.</p><a href="/account/addresses" className="mt-6 inline-flex rounded-full bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground">Manage addresses</a></div>;

  return <div className="grid gap-8 lg:grid-cols-[1fr_360px]">
    <section className="space-y-6">
      <div className="rounded-2xl border p-6"><h2 className="font-semibold">Delivery address</h2><select value={addressId} onChange={(event) => setAddressId(event.target.value)} className="mt-4 h-11 w-full rounded-xl border bg-background px-4 text-sm" aria-label="Delivery address">{addresses.map((address) => <option key={address.id} value={address.id}>{address.label} — {address.fullName}, {address.city}</option>)}</select></div>
      <div className="rounded-2xl border divide-y">{preview.items.map((item) => <div key={`${item.productId}:${item.variantId ?? ""}`} className="flex items-center justify-between gap-4 p-5"><div className="min-w-0"><p className="font-medium">{item.productName}</p><p className="mt-1 text-xs text-muted">{item.variantName ? `${item.variantName} · ` : ""}Qty {item.quantity}</p></div><p className="shrink-0 font-medium">{money(item.lineSubtotal)}</p></div>)}</div>
    </section>
    <aside className="h-fit rounded-2xl border bg-surface-muted p-6"><h2 className="font-semibold">Order review</h2><div className="mt-5 space-y-3 text-sm"><div className="flex justify-between"><span className="text-muted">Subtotal</span><span>{money(preview.subtotal)}</span></div><div className="flex justify-between"><span className="text-muted">Discount</span><span>{money(appliedCoupon?.discountAmount ?? preview.discountTotal)}</span></div><div className="flex justify-between"><span className="text-muted">Shipping</span><span>{money(preview.shippingTotal)}</span></div><div className="flex justify-between"><span className="text-muted">Tax</span><span>{money(preview.taxTotal)}</span></div><div className="flex justify-between border-t pt-4 text-base font-semibold"><span>Total</span><span>{money(Math.max(preview.subtotal - (appliedCoupon?.discountAmount ?? preview.discountTotal) + preview.shippingTotal + preview.taxTotal, 0))}</span></div></div><div className="mt-5 rounded-xl border bg-background p-4"><div className="flex gap-2"><input value={coupon} onChange={(e)=>setCoupon(e.target.value)} placeholder="Coupon code" aria-label="Coupon code" className="min-w-0 flex-1 rounded-lg border px-3 py-2 text-sm"/><button type="button" onClick={()=>void applyCoupon()} disabled={couponBusy} className="rounded-lg border px-3 py-2 text-sm font-semibold disabled:opacity-50">{couponBusy?"Checking…":"Apply"}</button></div>{couponMessage&&<p className="mt-2 text-xs text-muted">{couponMessage}</p>}{appliedCoupon&&<p className="mt-2 text-xs text-primary">{appliedCoupon.code} saves {money(appliedCoupon.discountAmount)}.</p>}</div><div className="mt-5 rounded-xl border bg-background p-4"><p className="text-sm font-medium">Razorpay</p><p className="mt-1 text-xs text-muted">Secure checkout for cards, UPI and supported payment methods.</p></div><button type="button" onClick={() => void startPayment()} disabled={status === "submitting"} className="mt-6 flex h-11 w-full items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-50">{status === "submitting" ? "Preparing payment…" : "Pay securely with Razorpay"}</button>{orderId && orderNumber && <p className="mt-3 text-center text-xs text-muted">Order {orderNumber} is created and remains unpaid until server verification succeeds.</p>}{status === "error" && <p role="alert" className="mt-3 text-center text-xs text-error">{message}</p>}{status !== "error" && message && <p className="mt-3 text-center text-xs text-muted">{message}</p>}</aside>
  </div>;
}

declare global { interface Window { Razorpay?: any } }
