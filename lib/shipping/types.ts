export type ShippingAddress = { fullName: string; phone: string; addressLine1: string; addressLine2?: string | null; landmark?: string | null; city: string; state: string; postalCode: string; country: string };
export type ShippingItem = { productName: string; sku: string | null; variantName: string | null; variantSku: string | null; quantity: number; unitPrice: number };
export type ProviderOrder = { providerOrderId: string; providerShipmentId?: string | null; awbCode?: string | null; labelUrl?: string | null };
export type Shipment = { carrier: string; trackingNumber: string; shippingMethod: string; provider?: string; providerOrderId?: string | null; providerShipmentId?: string | null; awbCode?: string | null; labelUrl?: string | null };
export type CreateShipmentInput = { sourceOrderId: string; sourceOrderNumber: string; customer: { name: string; email: string | null; phone: string }; address: ShippingAddress; items: ShippingItem[]; currency: string; orderTotal: number; shippingMethod: string; package: { weightKg: number; lengthCm: number; breadthCm: number; heightCm: number } };
export interface ShippingProvider {
  createShipment(input: CreateShipmentInput): Promise<Shipment>;
  findShipmentByReference(reference: string): Promise<Shipment | null>;
  createProviderOrder?(input: CreateShipmentInput, operationKey: string): Promise<ProviderOrder>;
  assignShipment?(providerOrderId: string, providerShipmentId: string, input: CreateShipmentInput): Promise<Shipment>;
  getShipment(identifier: string): Promise<Shipment | null>;
  cancelShipment(identifier: string): Promise<void>;
  getTracking(identifier: string): Promise<Shipment | null>;
}
