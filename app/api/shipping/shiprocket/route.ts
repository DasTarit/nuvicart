import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { serverEnv } from "@/lib/env";
import { shiprocketOperationKey, shiprocketShippingProvider, ShippingProviderError } from "@/lib/shipping/shiprocket";
import { recordAdminAudit } from "@/lib/auth/admin-audit";

function errorResponse(error: unknown) { const e = error as Partial<ShippingProviderError>; return NextResponse.json({ error: e.message ?? "SHIPPING_OPERATION_FAILED", code: e.code ?? "SHIPPING_OPERATION_FAILED" }, { status: e.retryable ? 503 : 422 }); }
export async function POST(request: Request) {
  try { const { role } = await requireAdmin(); if (role !== "admin" && role !== "super_admin") return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 }); } catch (error) { return NextResponse.json({ error: error instanceof Error && error.message === "UNAUTHENTICATED" ? "UNAUTHENTICATED" : "FORBIDDEN" }, { status: error instanceof Error && error.message === "UNAUTHENTICATED" ? 401 : 403 }); }
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body.fulfillmentId !== "string") return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });
  const supabase = await createClient();
  const { data: claim, error: claimError } = await supabase.rpc("claim_shiprocket_creation", { p_fulfillment_id: body.fulfillmentId });
  if (claimError) return errorResponse(claimError);
  const claimed = claim as Record<string, unknown>;
  if (claimed.status === "completed") return NextResponse.json({ fulfillment: claimed.fulfillment });
  if (claimed.status === "in_progress") return NextResponse.json({ error: "SHIPMENT_CREATION_IN_PROGRESS" }, { status: 503 });
  const token = String(claimed.processing_token);
  const admin = createAdminClient();
  try {
    const { data: fulfillment, error: fError } = await admin.from("fulfillments").select("id, order_id, status, shipping_address_snapshot, provider_operation_key, provider_order_id, provider_shipment_id, awb_code, provider_operation_status").eq("id", body.fulfillmentId).single();
    if (fError || !fulfillment) throw new Error("FULFILLMENT_NOT_FOUND");
    const { data: order, error: oError } = await admin.from("orders").select("id, user_id, order_number, status, payment_status, grand_total, currency, order_items(id, product_name, sku, variant_name, variant_sku, unit_price, quantity)").eq("id", fulfillment.order_id).single();
    if (oError || !order) throw new Error("ORDER_NOT_FOUND");
    const [{ data: profile }, { data: authUser }] = await Promise.all([
      admin.from("profiles").select("display_name, phone").eq("user_id", order.user_id).maybeSingle(),
      admin.auth.admin.getUserById(order.user_id),
    ]);
    const a = fulfillment.shipping_address_snapshot as Record<string, unknown>;
    const input = {
      sourceOrderId: String(order.id), sourceOrderNumber: String(order.order_number),
      customer: { name: String(a.full_name ?? profile?.display_name ?? "Customer"), email: authUser.user?.email ?? null, phone: String(a.phone ?? profile?.phone ?? "") },
      address: { fullName: String(a.full_name ?? "Customer"), phone: String(a.phone ?? ""), addressLine1: String(a.address_line_1 ?? ""), addressLine2: a.address_line_2 == null ? null : String(a.address_line_2), landmark: a.landmark == null ? null : String(a.landmark), city: String(a.city ?? ""), state: String(a.state ?? ""), postalCode: String(a.postal_code ?? ""), country: String(a.country ?? "India") },
      items: (order.order_items as Array<Record<string, unknown>>).map(i => ({ productName: String(i.product_name), sku: i.sku == null ? null : String(i.sku), variantName: i.variant_name == null ? null : String(i.variant_name), variantSku: i.variant_sku == null ? null : String(i.variant_sku), quantity: Number(i.quantity), unitPrice: Number(i.unit_price) })),
      currency: String(order.currency), orderTotal: Number(order.grand_total), shippingMethod: "Shiprocket",
      package: { weightKg: serverEnv.SHIPROCKET_PACKAGE_WEIGHT_KG, lengthCm: serverEnv.SHIPROCKET_PACKAGE_LENGTH_CM, breadthCm: serverEnv.SHIPROCKET_PACKAGE_BREADTH_CM, heightCm: serverEnv.SHIPROCKET_PACKAGE_HEIGHT_CM },
    };
    const operationKey = String(fulfillment.provider_operation_key ?? shiprocketOperationKey(String(fulfillment.id)));

    // First reconcile any provider object that may already exist. Never create after an unknown outcome without this check.
    let providerOrderId = fulfillment.provider_order_id ? String(fulfillment.provider_order_id) : null;
    let providerShipmentId = fulfillment.provider_shipment_id ? String(fulfillment.provider_shipment_id) : null;
    let existing = await shiprocketShippingProvider.findShipmentByReference(operationKey);
    if (!existing && order.order_number !== operationKey) existing = await shiprocketShippingProvider.findShipmentByReference(String(order.order_number));
    if (existing?.providerOrderId) {
      providerOrderId = existing.providerOrderId;
      providerShipmentId = existing.providerShipmentId ?? providerShipmentId;
      const { error: persistedError } = await supabase.rpc("record_shiprocket_provider_order", { p_fulfillment_id: body.fulfillmentId, p_processing_token: token, p_provider_order_id: providerOrderId, p_provider_shipment_id: providerShipmentId });
      if (persistedError) throw persistedError;
    }

    if (!providerOrderId) {
      if (!shiprocketShippingProvider.createProviderOrder) throw new Error("SHIPROCKET_PROVIDER_ORDER_CREATE_UNAVAILABLE");
      const created = await shiprocketShippingProvider.createProviderOrder(input, operationKey);
      providerOrderId = created.providerOrderId; providerShipmentId = created.providerShipmentId ?? null;
      const { error: persistedError } = await supabase.rpc("record_shiprocket_provider_order", { p_fulfillment_id: body.fulfillmentId, p_processing_token: token, p_provider_order_id: providerOrderId, p_provider_shipment_id: providerShipmentId });
      if (persistedError) throw persistedError;
    }

    let shipment = existing?.awbCode ? existing : null;
    if (!shipment && fulfillment.awb_code) shipment = await shiprocketShippingProvider.getTracking(String(fulfillment.awb_code));
    if (!shipment && providerShipmentId && shiprocketShippingProvider.getShipment) shipment = await shiprocketShippingProvider.getShipment(providerShipmentId);
    if (!shipment?.awbCode && shiprocketShippingProvider.assignShipment && providerShipmentId) {
      shipment = await shiprocketShippingProvider.assignShipment(providerOrderId, providerShipmentId, input);
    }
    if (!shipment?.awbCode) throw new ShippingProviderError("RECOVERY_REQUIRED", "Shiprocket shipment requires provider verification before it can be marked shipped.", true);

    const { data: completed, error } = await supabase.rpc("complete_shiprocket_creation", { p_fulfillment_id: body.fulfillmentId, p_processing_token: token, p_provider_order_id: providerOrderId, p_provider_shipment_id: shipment.providerShipmentId ?? providerShipmentId, p_awb_code: shipment.awbCode ?? shipment.trackingNumber, p_carrier: shipment.carrier, p_label_url: shipment.labelUrl ?? null });
    if (error) throw error;
    await recordAdminAudit("shiprocket_shipment_confirmed","fulfillment",body.fulfillmentId,{provider:"shiprocket"},`shiprocket:confirmed:${body.fulfillmentId}:${String(shipment.awbCode ?? shipment.trackingNumber)}`);
    return NextResponse.json({ fulfillment: completed });
  } catch (error) {
    try { await supabase.rpc("release_shiprocket_creation", { p_fulfillment_id: body.fulfillmentId, p_processing_token: token, p_error: error instanceof Error ? error.message : "SHIPROCKET_OPERATION_FAILED" }); } catch { /* preserve original failure */ }
    return errorResponse(error);
  }
}

export async function GET() {
  try { const { role } = await requireAdmin(); if (role !== "admin" && role !== "super_admin") return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 }); } catch (error) { return NextResponse.json({ error: error instanceof Error && error.message === "UNAUTHENTICATED" ? "UNAUTHENTICATED" : "FORBIDDEN" }, { status: error instanceof Error && error.message === "UNAUTHENTICATED" ? 401 : 403 }); }
  const admin = createAdminClient();
  const { data, error } = await admin.from("fulfillments").select("id, order_id, status, shipping_provider, provider_order_id, provider_shipment_id, awb_code, carrier, shipping_method, shipping_error, created_at, shipped_at, delivered_at, orders(order_number)").order("created_at", { ascending: false }).limit(100);
  if (error) return NextResponse.json({ error: "SHIPPING_LIST_FAILED" }, { status: 500 });
  return NextResponse.json({ fulfillments: data ?? [] });
}
