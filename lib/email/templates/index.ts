import { z } from "zod";

const Item = z.object({ productName: z.string(), sku: z.string().nullable().optional(), variantName: z.string().nullable().optional(), variantSku: z.string().nullable().optional(), unitPrice: z.number(), quantity: z.number(), lineSubtotal: z.number() });
const OrderPayload = z.object({ orderNumber: z.string(), status: z.string(), paymentStatus: z.string(), currency: z.string(), subtotal: z.number(), discountTotal: z.number(), shippingTotal: z.number(), taxTotal: z.number(), grandTotal: z.number(), shippingAddress: z.record(z.string(), z.unknown()).nullable().optional(), billingAddress: z.record(z.string(), z.unknown()).nullable().optional(), items: z.array(Item), createdAt: z.string() });
const FulfillmentPayload = z.object({ orderNumber: z.string(), orderStatus: z.string(), paymentStatus: z.string(), fulfillmentId: z.string(), fulfillmentStatus: z.string(), carrier: z.string().nullable().optional(), trackingNumber: z.string().nullable().optional(), shippingMethod: z.string().nullable().optional(), shippingAddress: z.record(z.string(), z.unknown()), shippedAt: z.string().nullable().optional(), deliveredAt: z.string().nullable().optional(), cancelledAt: z.string().nullable().optional(), shippingProvider: z.string().nullable().optional(), providerShipmentId: z.string().nullable().optional() });
export type EmailTemplate = { subject: string; html: string; text: string };
const escape = (value: string) => { const entities: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }; return value.replace(/[&<>"']/g, (c) => entities[c] ?? c); };
const money = (n: number, currency: string) => `${currency} ${n.toFixed(2)}`;
const shell = (title: string, body: string) => `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta charset="utf-8"><title>${escape(title)}</title></head><body style="margin:0;background:#f6f7f9;font-family:Arial,sans-serif;color:#172033"><main style="max-width:620px;margin:0 auto;padding:24px"><section style="background:#fff;border-radius:14px;padding:28px;box-shadow:0 1px 4px rgba(0,0,0,.08)"><div style="font-size:22px;font-weight:700;margin-bottom:20px">Nuvicart</div>${body}</section><p style="font-size:12px;color:#667085;text-align:center;margin:18px 0">This is a transactional message about your Nuvicart order.</p></main></body></html>`;
const orderTemplate = (title: string, intro: string, p: z.infer<typeof OrderPayload>) => {
  const items = p.items.map((i) => `<tr><td style="padding:10px 0;border-bottom:1px solid #eee">${escape(i.productName)}${i.variantName ? `<br><small>${escape(i.variantName)}</small>` : ""}</td><td style="padding:10px 0;border-bottom:1px solid #eee;text-align:center">${i.quantity}</td><td style="padding:10px 0;border-bottom:1px solid #eee;text-align:right">${money(i.lineSubtotal,p.currency)}</td></tr>`).join("");
  const body = `<h1 style="font-size:24px">${escape(title)}</h1><p>${escape(intro)}</p><p><strong>Order:</strong> ${escape(p.orderNumber)}</p><table width="100%" style="border-collapse:collapse"><tbody>${items}</tbody></table><p style="text-align:right;font-size:18px"><strong>Total: ${money(p.grandTotal,p.currency)}</strong></p>`;
  const text = `${title}\n${intro}\nOrder: ${p.orderNumber}\nTotal: ${money(p.grandTotal,p.currency)}\n` + p.items.map((i) => `${i.productName} x${i.quantity}: ${money(i.lineSubtotal,p.currency)}`).join("\n");
  return { html: shell(title, body), text };
};
const fulfillmentTemplate = (title: string, intro: string, p: z.infer<typeof FulfillmentPayload>) => {
  const details = [`Order: ${p.orderNumber}`, p.carrier ? `Carrier: ${p.carrier}` : "", p.trackingNumber ? `Tracking: ${p.trackingNumber}` : ""].filter(Boolean);
  const body = `<h1 style="font-size:24px">${escape(title)}</h1><p>${escape(intro)}</p>${details.map((x) => `<p>${escape(x)}</p>`).join("")}`;
  return { html: shell(title, body), text: `${title}\n${intro}\n${details.join("\n")}` };
};

export function renderEmailTemplate(eventType: string, rawPayload: unknown): EmailTemplate {
  if (["order_confirmation","payment_success","payment_failure","order_cancelled"].includes(eventType)) {
    const p = OrderPayload.parse(rawPayload);
    const copy: Record<string, [string,string]> = {
      order_confirmation: ["Order confirmed", "Thanks for shopping with Nuvicart. Your order has been created."],
      payment_success: ["Payment successful", "Your payment was successfully confirmed for this order."],
      payment_failure: ["Payment update", "Your payment attempt was not successful. You can review the order and retry payment if it remains payable."],
      order_cancelled: ["Order cancelled", "Your order has been cancelled."],
    };
    const [subject, intro] = copy[eventType];
    return { subject: `${subject} — ${p.orderNumber}`, ...orderTemplate(subject, intro, p) };
  }
  const p = FulfillmentPayload.parse(rawPayload);
  const copy: Record<string, [string,string]> = {
    shipment_created: ["Shipment created", "Your order has been handed to the shipping process and tracking details are available."],
    shipment_tracking_updated: ["Tracking updated", "There is a new tracking update for your shipment."],
    order_delivered: ["Order delivered", "Your order has been marked as delivered."],
  };
  const [subject, intro] = copy[eventType];
  return { subject: `${subject} — ${p.orderNumber}`, ...fulfillmentTemplate(subject, intro, p) };
}
