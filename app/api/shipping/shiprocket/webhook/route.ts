import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { serverEnv } from "@/lib/env";
import { createHash, timingSafeEqual } from "node:crypto";

function eventId(payload: Record<string, unknown>, raw: string) { const stable = [payload.sr_order_id ?? "", payload.awb ?? "", payload.current_timestamp ?? "", payload.current_status ?? payload.shipment_status ?? ""].join("|"); return createHash("sha256").update(stable || raw).digest("hex"); }
export async function POST(request: Request) {
  const secret = serverEnv.SHIPROCKET_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "WEBHOOK_NOT_CONFIGURED" }, { status: 503 });
  const raw = await request.text();
  const supplied = request.headers.get("x-api-key");
  if (!supplied) return NextResponse.json({ error: "INVALID_WEBHOOK_AUTH" }, { status: 401 });
  const a = Buffer.from(supplied); const b = Buffer.from(secret);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return NextResponse.json({ error: "INVALID_WEBHOOK_AUTH" }, { status: 401 });
  let payload: Record<string, unknown>;
  try { payload = JSON.parse(raw) as Record<string, unknown>; } catch { return NextResponse.json({ error: "INVALID_JSON" }, { status: 400 }); }
  const awb = typeof payload.awb === "string" ? payload.awb : null;
  const providerOrderId = payload.sr_order_id == null ? null : String(payload.sr_order_id);
  const providerShipmentId = payload.shipment_id == null ? null : String(payload.shipment_id);
  const status = typeof payload.current_status === "string" ? payload.current_status : typeof payload.shipment_status === "string" ? payload.shipment_status : null;
  if (!status || (!awb && !providerOrderId && !providerShipmentId)) return NextResponse.json({ error: "INVALID_WEBHOOK_PAYLOAD" }, { status: 400 });
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("record_shiprocket_webhook", { p_provider_event_id: eventId(payload, raw), p_payload: payload, p_awb: awb, p_provider_order_id: providerOrderId, p_provider_shipment_id: providerShipmentId, p_status: status, p_carrier: typeof payload.courier_name === "string" ? payload.courier_name : null });
  if (error) return NextResponse.json({ error: "WEBHOOK_PROCESSING_FAILED" }, { status: 503 });
  return NextResponse.json(data ?? { status: "processed" }, { status: 200 });
}
export async function GET() { return NextResponse.json({ error: "METHOD_NOT_ALLOWED" }, { status: 405, headers: { allow: "POST" } }); }
