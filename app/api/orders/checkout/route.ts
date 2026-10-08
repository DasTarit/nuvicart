import { NextResponse } from "next/server";
import { createOrderFromCart } from "@/features/orders/service";

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "CHECKOUT_FAILED";
  const status = message.includes("UNAUTHENTICATED") ? 401
    : message.includes("EMPTY_CART") ? 400
    : message.includes("INVALID_ADDRESS") || message.includes("INVALID_IDEMPOTENCY_KEY") || message.includes("INVALID_QUANTITY") ? 400
    : message.startsWith("PROMOTION_") ? 409
    : message.includes("INSUFFICIENT_STOCK") || message.includes("UNAVAILABLE_PRODUCT") || message.includes("UNAVAILABLE_VARIANT") || message.includes("VARIANT_REQUIRED") ? 409
    : 500;
  const publicMessage = status === 401 ? "Please sign in to continue checkout."
    : status === 400 ? "Please review your checkout details and try again."
    : status === 409 ? (message.startsWith("PROMOTION_") ? "That coupon is no longer valid for this checkout. Please review it and try again." : "One or more cart items are no longer available. Please review your cart.")
    : "We couldn't create your order. Please try again.";
  return NextResponse.json({ error: publicMessage }, { status });
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null) as { addressId?: unknown; idempotencyKey?: unknown; promotionCode?: unknown } | null;
    if (!body || typeof body.addressId !== "string" || typeof body.idempotencyKey !== "string" || (body.promotionCode !== undefined && body.promotionCode !== null && typeof body.promotionCode !== "string")) {
      return NextResponse.json({ error: "Invalid checkout input." }, { status: 400 });
    }
    const order = await createOrderFromCart({ addressId: body.addressId, idempotencyKey: body.idempotencyKey, promotionCode: body.promotionCode == null ? null : String(body.promotionCode) });
    return NextResponse.json({ order });
  } catch (error) {
    return errorResponse(error);
  }
}
