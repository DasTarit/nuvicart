export type OrderStatus = "pending_payment" | "paid" | "processing" | "shipped" | "delivered" | "cancelled" | "refunded";
export type PaymentStatus = "pending" | "paid" | "failed" | "paid_inventory_issue" | "refunded";

export type OrderItem = {
  id: string;
  productId: string | null;
  variantId: string | null;
  productName: string;
  sku: string | null;
  variantName: string | null;
  variantSku: string | null;
  unitPrice: number;
  quantity: number;
  lineSubtotal: number;
};

export type Order = {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  currency: "INR";
  subtotal: number;
  discountTotal: number;
  shippingTotal: number;
  taxTotal: number;
  grandTotal: number;
  billingAddressSnapshot: Record<string, string | null> | null;
  shippingAddressSnapshot: Record<string, string | null>;
  createdAt: string;
  updatedAt: string;
  items: OrderItem[];
  fulfillment: FulfillmentSummary | null;
};

export type FulfillmentSummary = { status: "pending" | "processing" | "ready_to_ship" | "shipped" | "delivered" | "cancelled"; carrier: string | null; trackingNumber: string | null; shippedAt: string | null; deliveredAt: string | null; };

export type OrderSummary = Pick<Order, "id" | "orderNumber" | "status" | "paymentStatus" | "currency" | "subtotal" | "discountTotal" | "shippingTotal" | "taxTotal" | "grandTotal"> & { itemCount: number; fulfillment: FulfillmentSummary | null };
