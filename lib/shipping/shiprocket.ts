import "server-only";
import { createHash } from "node:crypto";
import { serverEnv } from "@/lib/env";
import type { CreateShipmentInput, ProviderOrder, Shipment, ShippingProvider } from "./types";

type Json = Record<string, unknown>;
const TOKEN_SKEW_MS = 5 * 60 * 1000;
let tokenCache: { token: string; expiresAt: number } | null = null;

export class ShippingProviderError extends Error { constructor(public readonly code: string, message: string, public readonly retryable = false) { super(message); this.name = "ShippingProviderError"; } }

function configured() { return Boolean(serverEnv.SHIPROCKET_EMAIL && serverEnv.SHIPROCKET_PASSWORD); }
function url(path: string) { return `${serverEnv.SHIPROCKET_BASE_URL.replace(/\/$/, "")}/${path.replace(/^\//, "")}`; }
function safeMessage(status: number, body: unknown) { const detail = body && typeof body === "object" ? ((body as Json).message ?? (body as Json).error) : undefined; return `Shiprocket request failed (${status})${typeof detail === "string" ? `: ${detail.slice(0,160)}` : ""}`; }

async function authenticate(force = false): Promise<string> {
  if (!configured()) throw new ShippingProviderError("NOT_CONFIGURED", "Shiprocket is not configured.");
  if (!force && tokenCache && tokenCache.expiresAt > Date.now() + TOKEN_SKEW_MS) return tokenCache.token;
  let response: Response;
  try { response = await fetch(url("auth/login"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: serverEnv.SHIPROCKET_EMAIL, password: serverEnv.SHIPROCKET_PASSWORD }), cache: "no-store" }); }
  catch { throw new ShippingProviderError("NETWORK", "Shiprocket authentication is temporarily unavailable.", true); }
  const body = await response.json().catch(() => null) as Json | null;
  if (!response.ok || typeof body?.token !== "string") throw new ShippingProviderError(response.status === 401 ? "AUTH" : "AUTH_RESPONSE", "Shiprocket authentication failed.", response.status >= 500 || response.status === 429);
  tokenCache = { token: body.token, expiresAt: Date.now() + 9 * 24 * 60 * 60 * 1000 };
  return body.token;
}

async function request(path: string, init: RequestInit = {}, retryAuth = true, allowNotFound = false): Promise<Json> {
  const token = await authenticate(false);
  let response: Response;
  try { response = await fetch(url(path), { ...init, headers: { "content-type": "application/json", ...(init.headers ?? {}), authorization: `Bearer ${token}` }, cache: "no-store" }); }
  catch { throw new ShippingProviderError("NETWORK", "Shiprocket is temporarily unavailable.", true); }
  const body = await response.json().catch(() => null) as Json | null;
  if (response.status === 401 && retryAuth) { tokenCache = null; return request(path, init, false, allowNotFound); }
  if (response.status === 404 && allowNotFound) return {};
  if (!response.ok || !body) throw new ShippingProviderError(response.status === 429 ? "RATE_LIMIT" : response.status >= 500 ? "PROVIDER_5XX" : "PROVIDER_4XX", safeMessage(response.status, body), response.status === 429 || response.status >= 500);
  return body;
}

function mapAddress(a: CreateShipmentInput["address"]) { return { first_name: a.fullName.trim().split(/\s+/)[0], last_name: a.fullName.trim().split(/\s+/).slice(1).join(" "), email: "", phone: a.phone, address: a.addressLine1, address_2: [a.addressLine2, a.landmark].filter(Boolean).join(", "), city: a.city, state: a.state, country: a.country, pincode: a.postalCode }; }
function nested(body: Json): Json { const response = body.response; if (response && typeof response === "object") { const data = (response as Json).data; if (data && typeof data === "object") return { ...body, ...(data as Json) }; return { ...body, ...(response as Json) }; } return body; }
function mapShipmentResponse(body: Json, input: CreateShipmentInput): Shipment { const data = nested(body); const orderId = data.order_id ?? data.orderId; const shipmentId = data.shipment_id ?? data.shipmentId; const awb = data.awb_code ?? data.awb; const courier = data.courier_name ?? data.courier; if (typeof orderId !== "number" && typeof orderId !== "string") throw new ShippingProviderError("MALFORMED_RESPONSE", "Shiprocket did not return an order identifier."); if (typeof shipmentId !== "number" && typeof shipmentId !== "string") throw new ShippingProviderError("MALFORMED_RESPONSE", "Shiprocket did not return a shipment identifier."); if (typeof awb !== "string" || !awb) throw new ShippingProviderError("AWB_REQUIRED", "Shiprocket did not return an AWB after shipment assignment.", true); return { carrier: typeof courier === "string" && courier ? courier : "Shiprocket", trackingNumber: awb, shippingMethod: input.shippingMethod, provider: "shiprocket", providerOrderId: String(orderId), providerShipmentId: String(shipmentId), awbCode: awb, labelUrl: typeof data.label_url === "string" ? data.label_url : null }; }

async function createProviderOrder(input: CreateShipmentInput, operationKey: string): Promise<ProviderOrder> {
  if (!serverEnv.SHIPROCKET_PICKUP_LOCATION) throw new ShippingProviderError("PICKUP_NOT_CONFIGURED", "Shiprocket pickup location is not configured.");
  const orderBody = { order_id: operationKey, order_date: new Date().toISOString().slice(0,19).replace("T", " "), pickup_location: serverEnv.SHIPROCKET_PICKUP_LOCATION, billing_customer_name: input.address.fullName, billing_last_name: input.address.fullName.trim().split(/\s+/).slice(1).join(" "), billing_address: input.address.addressLine1, billing_address_2: [input.address.addressLine2, input.address.landmark].filter(Boolean).join(", "), billing_city: input.address.city, billing_pincode: input.address.postalCode, billing_state: input.address.state, billing_country: input.address.country, billing_email: input.customer.email ?? "", billing_phone: input.address.phone, shipping_is_billing: true, order_items: input.items.map(i => ({ name: i.productName, sku: i.variantSku ?? i.sku ?? i.productName, units: i.quantity, selling_price: i.unitPrice, discount: 0, tax: 0, hsn: "" })), payment_method: "Prepaid", sub_total: input.orderTotal, length: input.package.lengthCm, breadth: input.package.breadthCm, height: input.package.heightCm, weight: input.package.weightKg };
  const created = await request("orders/create/adhoc", { method: "POST", body: JSON.stringify(orderBody) });
  const orderId = created.order_id ?? created.orderId; const shipmentId = created.shipment_id ?? created.shipmentId;
  if ((typeof orderId !== "number" && typeof orderId !== "string") || (typeof shipmentId !== "number" && typeof shipmentId !== "string")) throw new ShippingProviderError("MALFORMED_RESPONSE", "Shiprocket order creation returned incomplete identifiers.");
  return { providerOrderId: String(orderId), providerShipmentId: String(shipmentId) };
}

async function assignShipment(providerOrderId: string, providerShipmentId: string, input: CreateShipmentInput): Promise<Shipment> {
  const awbBody = await request("courier/assign/awb", { method: "POST", body: JSON.stringify({ shipment_id: Number(providerShipmentId) }) });
  return mapShipmentResponse({ order_id: providerOrderId, shipment_id: providerShipmentId, ...awbBody }, input);
}

export function shiprocketOperationKey(fulfillmentId: string): string {
  return `NVC${createHash("sha256").update(fulfillmentId).digest("hex").slice(0, 17)}`;
}

export const shiprocketShippingProvider: ShippingProvider = {
  async createShipment(input) {
    const created = await createProviderOrder(input, input.sourceOrderNumber);
    return assignShipment(created.providerOrderId, String(created.providerShipmentId), input);
  },
  async findShipmentByReference(reference) {
    // Shiprocket documents order-list search by the merchant/channel order reference.
    // This is used only for reconciliation; it is never used to invent a local shipped state.
    const body = await request(`orders?search=${encodeURIComponent(reference)}&per_page=10`, { method: "GET", headers: {} }, true, true);
    const rows = Array.isArray(body.data) ? body.data : Array.isArray(body.orders) ? body.orders : [];
    const match = rows.find((row) => {
      if (!row || typeof row !== "object") return false;
      const r = row as Json;
      return String(r.channel_order_id ?? r.order_id ?? r.orderId ?? "") === reference;
    }) as Json | undefined;
    if (!match) return null;
    const orderId = match.id ?? match.order_id ?? match.orderId;
    const shipment = match.shipments && Array.isArray(match.shipments) && match.shipments[0] && typeof match.shipments[0] === "object" ? match.shipments[0] as Json : null;
    const shipmentId = shipment?.id ?? shipment?.shipment_id ?? match.shipment_id;
    const awb = shipment?.awb ?? shipment?.awb_code ?? match.awb_code;
    if (orderId == null) return null;
    return {
      carrier: typeof shipment?.courier_name === "string" ? shipment.courier_name : "Shiprocket",
      trackingNumber: typeof awb === "string" ? awb : "",
      shippingMethod: "Shiprocket",
      provider: "shiprocket",
      providerOrderId: String(orderId),
      providerShipmentId: shipmentId == null ? null : String(shipmentId),
      awbCode: typeof awb === "string" && awb ? awb : null,
      labelUrl: typeof shipment?.label_url === "string" ? shipment.label_url : null,
    };
  },
  async createProviderOrder(input, operationKey) { return createProviderOrder(input, operationKey); },
  async assignShipment(providerOrderId, providerShipmentId, input) { return assignShipment(providerOrderId, providerShipmentId, input); },
  async getShipment(identifier) { const body = await request(`courier/track/shipment/${encodeURIComponent(identifier)}`, { method: "GET", headers: {} }); return mapTracking(body); },
  async cancelShipment(identifier) { await request("orders/cancel", { method: "POST", body: JSON.stringify({ ids: [Number(identifier)] }) }); },
  async getTracking(identifier) { const body = await request(`courier/track/awb/${encodeURIComponent(identifier)}`, { method: "GET", headers: {} }); return mapTracking(body); },
};
function mapTracking(body: Json): Shipment | null { const base = nested(body); const trackingData = base.tracking_data; const d = (trackingData && typeof trackingData === "object" ? trackingData : base) as Json; const first = Array.isArray(d.shipment_track) && d.shipment_track[0] && typeof d.shipment_track[0] === "object" ? d.shipment_track[0] as Json : d; const awb = first.awb_code ?? first.awb ?? base.awb_code ?? base.awb; if (typeof awb !== "string" || !awb) return null; return { carrier: typeof first.courier_name === "string" ? first.courier_name : "Shiprocket", trackingNumber: awb, shippingMethod: typeof first.current_status === "string" ? first.current_status : "Shiprocket", provider: "shiprocket", awbCode: awb, providerOrderId: base.order_id == null ? null : String(base.order_id), providerShipmentId: base.shipment_id == null ? null : String(base.shipment_id) }; }
