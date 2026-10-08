import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchRazorpayPayment, verifyWebhookSignature } from "@/lib/payments/razorpay";

// Persisted in payment_webhook_events; claim/complete/release RPCs keep retries durable and idempotent.
type Claim = { status: "claimed" | "processed" | "in_progress"; event_id: string; processing_token?: string };

export async function POST(request: Request) {
  let claim: Claim | null = null;
  const admin = createAdminClient();

  try {
    const rawBody = await request.text();
    const signature = request.headers.get("x-razorpay-signature");
    const eventId = request.headers.get("x-razorpay-event-id");
    if (!signature || !eventId) return NextResponse.json({ error: "Invalid webhook headers." }, { status: 400 });
    if (!verifyWebhookSignature(rawBody, signature)) return NextResponse.json({ error: "Invalid webhook signature." }, { status: 400 });

    const payload = JSON.parse(rawBody) as Record<string, any>;
    const event = String(payload.event ?? "");
    const { data: claimed, error: claimError } = await admin.rpc("claim_razorpay_webhook_event", {
      p_provider_event_id: eventId,
      p_event_type: event,
      p_payload: payload,
      p_signature_verified: true,
    });
    if (claimError) throw claimError;
    claim = claimed as Claim;

    if (claim.status === "processed") return NextResponse.json({ received: true, duplicate: true });
    if (claim.status === "in_progress") {
      return NextResponse.json({ error: "Webhook event is already being processed; retry later." }, { status: 503 });
    }

    const entity = payload?.payload?.payment?.entity ?? payload?.payload?.order?.entity ?? null;
    const providerOrderId = typeof entity?.order_id === "string" ? entity.order_id : null;
    const paymentId = typeof entity?.id === "string" ? entity.id : null;

    if (providerOrderId) {
      const { data: attempt, error: attemptError } = await admin
        .from("payment_attempts")
        .select("id, provider_order_id")
        .eq("provider", "razorpay")
        .eq("provider_order_id", providerOrderId)
        .maybeSingle();
      if (attemptError) throw attemptError;

      if (attempt && ["payment.captured", "order.paid"].includes(event) && paymentId) {
        const payment = await fetchRazorpayPayment(paymentId);
        if (payment.order_id !== providerOrderId || payment.status !== "captured") {
          throw new Error("RAZORPAY_PAYMENT_NOT_CAPTURED");
        }
        const { error } = await admin.rpc("finalize_razorpay_payment", {
          p_attempt_id: attempt.id,
          p_provider_payment_id: payment.id,
          p_provider_order_id: payment.order_id,
          p_amount_minor: payment.amount,
          p_currency: payment.currency,
          p_signature_verified: true,
          p_provider_event_id: eventId,
        });
        if (error) {
          if (!error.message.includes("INSUFFICIENT_INVENTORY_AT_PAYMENT")) throw error;
          const { error: exceptionError } = await admin.rpc("record_razorpay_inventory_exception", {
            p_attempt_id: attempt.id,
            p_provider_payment_id: payment.id,
            p_provider_event_id: eventId,
          });
          if (exceptionError) throw exceptionError;
        }
      } else if (attempt && event === "payment.failed" && paymentId) {
        // A failure notification is not authoritative by itself. Re-fetch the
        // provider payment so a late/stale failure event cannot overwrite a
        // payment that is already captured.
        const payment = await fetchRazorpayPayment(paymentId);
        if (payment.order_id !== providerOrderId) throw new Error("RAZORPAY_PAYMENT_ORDER_MISMATCH");
        if (payment.status === "captured") {
          // Safe no-op: callback/webhook success owns the captured state.
        } else if (payment.status === "failed") {
          const { error } = await admin.rpc("record_razorpay_failure", {
            p_attempt_id: attempt.id,
            p_provider_payment_id: paymentId,
            p_failure_reason: entity?.error_description ?? entity?.error_reason ?? "Payment failed",
          });
          if (error) throw error;
        } else {
          throw new Error("RAZORPAY_PAYMENT_STATE_NOT_FAILURE");
        }
      }
    }

    const { error: completeError } = await admin.rpc("complete_razorpay_webhook_event", {
      p_event_id: claim.event_id,
      p_processing_token: claim.processing_token,
    });
    if (completeError) throw completeError;

    return NextResponse.json({ received: true });
  } catch {
    if (claim?.status === "claimed" && claim.processing_token) {
      await admin.rpc("release_razorpay_webhook_event", {
        p_event_id: claim.event_id,
        p_processing_token: claim.processing_token,
      }).catch(() => undefined);
    }
    return NextResponse.json({ error: "Webhook processing failed; Razorpay may retry the event." }, { status: 503 });
  }
}

export async function GET() {
  return NextResponse.json({ error: "Method not allowed." }, { status: 405, headers: { allow: "POST" } });
}
