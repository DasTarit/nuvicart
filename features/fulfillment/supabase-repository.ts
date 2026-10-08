import { createClient } from "@/lib/supabase/server";
import type { FulfillmentRepository } from "./repository";
import type { Fulfillment } from "./types";

function map(row: Record<string, unknown>): Fulfillment {
  return {
    id: String(row.id),
    orderId: String(row.order_id),
    status: row.status as Fulfillment["status"],
    carrier: row.carrier == null ? null : String(row.carrier),
    trackingNumber: row.tracking_number == null ? null : String(row.tracking_number),
    shippingMethod: row.shipping_method == null ? null : String(row.shipping_method),
    shippingAddressSnapshot: row.shipping_address_snapshot as Fulfillment["shippingAddressSnapshot"],
    shippedAt: row.shipped_at == null ? null : String(row.shipped_at),
    deliveredAt: row.delivered_at == null ? null : String(row.delivered_at),
    cancelledAt: row.cancelled_at == null ? null : String(row.cancelled_at),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export const fulfillmentRepository: FulfillmentRepository = {
  async getForOrder(orderId) {
    const supabase = await createClient();
    const { data, error } = await supabase.from("fulfillments").select("*").eq("order_id", orderId).maybeSingle();
    if (error) throw new Error(`Fulfillment query failed: ${error.message}`);
    return data ? map(data as Record<string, unknown>) : null;
  },
  async createForOrder(orderId) {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("create_fulfillment_for_order", { p_order_id: orderId });
    if (error) throw new Error(error.message);
    return map(data as Record<string, unknown>);
  },
  async transition(id, status) {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("transition_fulfillment", { p_fulfillment_id: id, p_status: status });
    if (error) throw new Error(error.message);
    return map(data as Record<string, unknown>);
  },
  async assignManualShipment(id, carrier, trackingNumber, shippingMethod) {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("assign_manual_shipment", {
      p_fulfillment_id: id,
      p_carrier: carrier,
      p_tracking_number: trackingNumber,
      p_shipping_method: shippingMethod,
    });
    if (error) throw new Error(error.message);
    return map(data as Record<string, unknown>);
  },
};
