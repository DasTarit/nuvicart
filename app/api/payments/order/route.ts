import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createRazorpayOrder, getRazorpayKeyId } from "@/lib/payments/razorpay";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null) as { orderId?: unknown } | null;
    if (!body || typeof body.orderId !== "string") return NextResponse.json({ error: "Invalid order." }, { status: 400 });
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Please sign in to pay for this order." }, { status: 401 });

    const { data: reopened, error: reopenError } = await supabase.rpc("reopen_failed_payment", { p_order_id: body.orderId });
    if (reopenError && !reopenError.message.includes("ORDER_NOT_RETRYABLE")) throw reopenError;
    if (reopened) { /* retry transition succeeded; prepare below */ }

    const { data: prepared, error: prepareError } = await supabase.rpc("prepare_payment_attempt", { p_order_id: body.orderId });
    if (prepareError) throw prepareError;
    const attempt = prepared as Record<string, unknown>;
    if (typeof attempt.provider_order_id === "string" && attempt.provider_order_id) {
      return NextResponse.json({ keyId: getRazorpayKeyId(), order: attempt });
    }

    const amount = Number(attempt.amount);
    if (!Number.isFinite(amount) || amount < 0) throw new Error("INVALID_ORDER_AMOUNT");
    const amountMinor = Math.round(amount * 100);
    const providerOrder = await createRazorpayOrder(amountMinor, String(attempt.currency), `nuvicart_${String(attempt.order_number)}`);
    if (providerOrder.amount !== amountMinor || providerOrder.currency !== String(attempt.currency)) throw new Error("RAZORPAY_ORDER_MISMATCH");

    const admin = createAdminClient();
    const { data: linked, error: linkError } = await admin.rpc("attach_provider_order", { p_attempt_id: String(attempt.attempt_id), p_provider_order_id: providerOrder.id });
    if (linkError) throw linkError;
    return NextResponse.json({ keyId: getRazorpayKeyId(), order: { ...attempt, ...linked, provider_order_id: providerOrder.id, amount_minor: amountMinor } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "PAYMENT_ORDER_FAILED";
    const status = message.includes("UNAUTHENTICATED") ? 401 : message.includes("ORDER_NOT_FOUND") || message.includes("ORDER_NOT_PAYABLE") || message.includes("ORDER_NOT_RETRYABLE") ? 409 : message === "RAZORPAY_NOT_CONFIGURED" ? 503 : 500;
    return NextResponse.json({ error: status === 503 ? "Payments are not configured yet." : "We couldn't initialize payment. Please try again." }, { status });
  }
}
