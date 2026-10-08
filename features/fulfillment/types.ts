export type FulfillmentStatus = "pending" | "processing" | "ready_to_ship" | "shipped" | "delivered" | "cancelled";

export type Fulfillment = {
  id: string;
  orderId: string;
  status: FulfillmentStatus;
  carrier: string | null;
  trackingNumber: string | null;
  shippingMethod: string | null;
  shippingAddressSnapshot: Record<string, string | null>;
  shippedAt: string | null;
  deliveredAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
};
