import type { Fulfillment, FulfillmentStatus } from "./types";

export interface FulfillmentRepository {
  getForOrder(orderId: string): Promise<Fulfillment | null>;
  createForOrder(orderId: string): Promise<Fulfillment>;
  transition(id: string, status: FulfillmentStatus): Promise<Fulfillment>;
  assignManualShipment(id: string, carrier: string, trackingNumber: string, shippingMethod: string): Promise<Fulfillment>;
}
