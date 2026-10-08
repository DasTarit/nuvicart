import type { CreateShipmentInput, Shipment, ShippingProvider } from "./types";
export const manualShippingProvider: ShippingProvider = {
  async createShipment(input: CreateShipmentInput) { return { carrier: "Manual", trackingNumber: `MANUAL-${input.sourceOrderNumber}`, shippingMethod: input.shippingMethod, provider: "manual" }; },
  async findShipmentByReference() { return null; },
  async getShipment() { return null; },
  async cancelShipment() { return; },
  async getTracking() { return null; },
};
