import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchRazorpayPayment, verifyPaymentSignature } from "@/lib/payments/razorpay";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null) as { orderId?: unknown; razorpay_order_id?: unknown; razorpay_payment_id?: unknown; razorpay_signature?: unknown } | null;
    if (!body || ![body.orderId, body.razorpay_order_id, body.razorpay_payment_id, body.razorpay_signature].every((v) => typeof v === "string")) return NextResponse.json({ error: "Invalid payment response." }, { status: 400 });
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Please sign in to verify payment." }, { status: 401 });

    const { data: attempt, error } = await supabase.from("payment_attempts").select("id, order_id, provider_order_id, amount, currency, status").eq("order_id", body.orderId).eq("provider", "razorpay").order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (error || !attempt) return NextResponse.json({ error: "Payment attempt not found." }, { status: 404 });
    if (attempt.order_id !== body.orderId || attempt.provider_order_id !== body.razorpay_order_id) return NextResponse.json({ error: "Payment does not match this order." }, { status: 409 });

    let signatureValid = false;
    try { signatureValid = verifyPaymentSignature(String(body.razorpay_order_id), String(body.razorpay_payment_id), String(body.razorpay_signature)); } catch { return NextResponse.json({ error: "Payment verification is not configured." }, { status: 503 }); }
    if (!signatureValid) return NextResponse.json({ error: "Payment signature verification failed." }, { status: 400 });

    const payment = await fetchRazorpayPayment(String(body.razorpay_payment_id));
    if (payment.order_id !== attempt.provider_order_id) return NextResponse.json({ error: "Payment order mismatch." }, { status: 400 });
    if (payment.amount !== Math.round(Number(attempt.amount) * 100) || payment.currency !== attempt.currency) return NextResponse.json({ error: "Payment amount or currency mismatch." }, { status: 400 });
    if (payment.status !== "captured") return NextResponse.json({ error: "Payment is not captured yet." }, { status: 409 });

    const admin = createAdminClient();
    const { data: result, error: finalizeError } = await admin.rpc("finalize_razorpay_payment", { p_attempt_id: attempt.id, p_provider_payment_id: payment.id, p_provider_order_id: payment.order_id, p_amount_minor: payment.amount, p_currency: payment.currency, p_signature_verified: true });
    if (finalizeError) {
      if (finalizeError.message.includes("INSUFFICIENT_INVENTORY_AT_PAYMENT")) {
        const { data: exceptional, error: exceptionError } = await admin.rpc("record_razorpay_inventory_exception", { p_attempt_id: attempt.id, p_provider_payment_id: payment.id });
        if (exceptionError) throw exceptionError;
        return NextResponse.json({ verified: true, exceptional: true, result: exceptional }, { status: 409 });
      }
      throw finalizeError;
    }
    return NextResponse.json({ verified: true, result });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error && error.message === "RAZORPAY_NOT_CONFIGURED" ? "Payments are not configured yet." : "We couldn't verify the payment." }, { status: error instanceof Error && error.message === "RAZORPAY_NOT_CONFIGURED" ? 503 : 500 });
  }
}
