import crypto from "node:crypto";
import { serverEnv } from "@/lib/env";

export type RazorpayOrder = { id: string; amount: number; currency: string; status: string };
export type RazorpayPayment = { id: string; order_id: string; amount: number; currency: string; status: string; error_description?: string };

function config() {
  const { RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET } = serverEnv;
  if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET || !RAZORPAY_WEBHOOK_SECRET) throw new Error("RAZORPAY_NOT_CONFIGURED");
  return { RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET };
}

async function request<T>(path: string, init: RequestInit = {}) {
  const { RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET } = config();
  const response = await fetch(`https://api.razorpay.com/v1${path}`, {
    ...init,
    headers: { "content-type": "application/json", authorization: `Basic ${Buffer.from(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`).toString("base64")}`, ...(init.headers ?? {}) },
    cache: "no-store",
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`RAZORPAY_API_${response.status}`);
  return body as T;
}

export function getRazorpayKeyId() { return config().RAZORPAY_KEY_ID; }
export function verifyPaymentSignature(orderId: string, paymentId: string, signature: string) {
  const { RAZORPAY_KEY_SECRET } = config();
  const expected = crypto.createHmac("sha256", RAZORPAY_KEY_SECRET).update(`${orderId}|${paymentId}`).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}
export function verifyWebhookSignature(rawBody: string, signature: string) {
  const { RAZORPAY_WEBHOOK_SECRET } = config();
  const expected = crypto.createHmac("sha256", RAZORPAY_WEBHOOK_SECRET).update(rawBody).digest("hex");
  if (expected.length !== signature.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}
export function createRazorpayOrder(amountMinor: number, currency: string, receipt: string) {
  return request<RazorpayOrder>("/orders", { method: "POST", body: JSON.stringify({ amount: amountMinor, currency, receipt, partial_payment: false }) });
}
export function fetchRazorpayPayment(paymentId: string) { return request<RazorpayPayment>(`/payments/${encodeURIComponent(paymentId)}`); }
