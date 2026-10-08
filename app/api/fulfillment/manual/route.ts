import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
import { assignManualShipment, createFulfillment, transitionFulfillment } from "@/features/fulfillment/service";
import type { FulfillmentStatus } from "@/features/fulfillment/types";
import { recordAdminAudit } from "@/lib/auth/admin-audit";

const transitions = new Set<FulfillmentStatus>(["processing", "ready_to_ship", "cancelled", "delivered"]);

export async function POST(request: Request) {
  try { const { role } = await requireAdmin(); if (role !== "admin" && role !== "super_admin") return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 }); } catch (error) { return NextResponse.json({ error: error instanceof Error && error.message === "UNAUTHENTICATED" ? "UNAUTHENTICATED" : "FORBIDDEN" }, { status: error instanceof Error && error.message === "UNAUTHENTICATED" ? 401 : 403 }); }
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body !== "object" || typeof body.orderId !== "string" || typeof body.action !== "string") {
    return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });
  }
  try {
    if (body.action === "create") { const fulfillment=await createFulfillment(body.orderId); await recordAdminAudit("fulfillment_created","fulfillment",fulfillment.id,{orderId:body.orderId},`fulfillment:create:${fulfillment.id}`); return NextResponse.json({ fulfillment }, { status: 201 }); }
    if (body.action === "transition" && typeof body.fulfillmentId === "string" && transitions.has(body.status as FulfillmentStatus)) {
      const fulfillment=await transitionFulfillment(body.fulfillmentId, body.status as FulfillmentStatus); await recordAdminAudit("fulfillment_transitioned","fulfillment",fulfillment.id,{status:body.status},`fulfillment:transition:${fulfillment.id}:${body.status}:${Date.now()}`); return NextResponse.json({ fulfillment });
    }
    if (body.action === "ship" && typeof body.fulfillmentId === "string" && typeof body.carrier === "string" && typeof body.trackingNumber === "string" && typeof body.shippingMethod === "string") {
      const fulfillment=await assignManualShipment(body.fulfillmentId, body.carrier, body.trackingNumber, body.shippingMethod); await recordAdminAudit("manual_shipment_assigned","fulfillment",fulfillment.id,{carrier:body.carrier,shippingMethod:body.shippingMethod},`fulfillment:ship:${fulfillment.id}:${fulfillment.shipped_at??Date.now()}`); return NextResponse.json({ fulfillment });
    }
    return NextResponse.json({ error: "INVALID_FULFILLMENT_OPERATION" }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "FULFILLMENT_OPERATION_FAILED" }, { status: 409 });
  }
}
