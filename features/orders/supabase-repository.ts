import { createClient } from "@/lib/supabase/server";
import type { CheckoutInput, OrderRepository } from "./repository";
import type { FulfillmentSummary, Order, OrderItem, OrderSummary } from "./types";

function mapSummary(row: Record<string, unknown>): OrderSummary {
  return {
    id: String(row.id),
    orderNumber: String(row.order_number),
    status: row.status as OrderSummary["status"],
    paymentStatus: row.payment_status as OrderSummary["paymentStatus"],
    currency: "INR",
    subtotal: Number(row.subtotal),
    discountTotal: Number(row.discount_total),
    shippingTotal: Number(row.shipping_total),
    taxTotal: Number(row.tax_total),
    grandTotal: Number(row.grand_total),
    createdAt: String(row.created_at),
    itemCount: Number(row.item_count ?? 0),
    fulfillment: (() => { const f = Array.isArray(row.fulfillments) ? row.fulfillments[0] as Record<string, unknown> | undefined : undefined; return f ? { status: f.status as FulfillmentSummary["status"], carrier: f.carrier == null ? null : String(f.carrier), trackingNumber: f.tracking_number == null ? null : String(f.tracking_number), shippedAt: f.shipped_at == null ? null : String(f.shipped_at), deliveredAt: f.delivered_at == null ? null : String(f.delivered_at) } : null; })(),
  };
}

function mapOrder(row: Record<string, unknown>, items: OrderItem[]): Order {
  return {
    id: String(row.id),
    orderNumber: String(row.order_number),
    status: row.status as Order["status"],
    paymentStatus: row.payment_status as Order["paymentStatus"],
    currency: "INR",
    subtotal: Number(row.subtotal),
    discountTotal: Number(row.discount_total),
    shippingTotal: Number(row.shipping_total),
    taxTotal: Number(row.tax_total),
    grandTotal: Number(row.grand_total),
    billingAddressSnapshot: (row.billing_address_snapshot as Order["billingAddressSnapshot"]) ?? null,
    shippingAddressSnapshot: row.shipping_address_snapshot as Order["shippingAddressSnapshot"],
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    items,
    fulfillment: (() => { const f = Array.isArray(row.fulfillments) ? row.fulfillments[0] as Record<string, unknown> | undefined : undefined; return f ? { status: f.status as FulfillmentSummary["status"], carrier: f.carrier == null ? null : String(f.carrier), trackingNumber: f.tracking_number == null ? null : String(f.tracking_number), shippedAt: f.shipped_at == null ? null : String(f.shipped_at), deliveredAt: f.delivered_at == null ? null : String(f.delivered_at) } : null; })(),
  };
}

export const orderRepository: OrderRepository = {
  async createFromCart(input: CheckoutInput) {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("create_order_from_cart", {
      p_address_id: input.addressId,
      p_idempotency_key: input.idempotencyKey,
      p_promotion_code: input.promotionCode ?? null,
    });
    if (error) throw new Error(error.message);
    const row = data as Record<string, unknown>;
    return mapSummary({ ...row, id: row.id ?? row.order_id });
  },

  async listOrders() {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("orders")
      .select("id, order_number, status, payment_status, currency, subtotal, discount_total, shipping_total, tax_total, grand_total, created_at, order_items(quantity), fulfillments(status, carrier, tracking_number, shipped_at, delivered_at)")
      .order("created_at", { ascending: false });
    if (error) throw new Error(`Order history query failed: ${error.message}`);
    return (data ?? []).map((row: Record<string, unknown>) => {
      const items = Array.isArray(row.order_items) ? row.order_items as Array<{ quantity: number }> : [];
      return mapSummary({ ...row, item_count: items.reduce((sum, item) => sum + Number(item.quantity), 0) });
    });
  },

  async getOrder(orderNumber) {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("orders")
      .select("id, order_number, status, payment_status, currency, subtotal, discount_total, shipping_total, tax_total, grand_total, billing_address_snapshot, shipping_address_snapshot, created_at, updated_at, order_items(id, product_id, variant_id, product_name, sku, variant_name, variant_sku, unit_price, quantity, line_subtotal, created_at), fulfillments(id, order_id, status, carrier, tracking_number, shipping_method, shipping_address_snapshot, shipped_at, delivered_at, cancelled_at, created_at, updated_at)")
      .eq("order_number", orderNumber)
      .maybeSingle();
    if (error) throw new Error(`Order query failed: ${error.message}`);
    if (!data) return undefined;
    const rawItems = Array.isArray(data.order_items) ? data.order_items as Array<Record<string, unknown>> : [];
    const items: OrderItem[] = rawItems.map((item) => ({
      id: String(item.id),
      productId: item.product_id == null ? null : String(item.product_id),
      variantId: item.variant_id == null ? null : String(item.variant_id),
      productName: String(item.product_name),
      sku: item.sku == null ? null : String(item.sku),
      variantName: item.variant_name == null ? null : String(item.variant_name),
      variantSku: item.variant_sku == null ? null : String(item.variant_sku),
      unitPrice: Number(item.unit_price),
      quantity: Number(item.quantity),
      lineSubtotal: Number(item.line_subtotal),
    }));
    return mapOrder(data as Record<string, unknown>, items);
  },
};
