import { fulfillmentRepository } from "./supabase-repository";
import type { FulfillmentStatus } from "./types";

export const getFulfillmentForOrder = (orderId: string) => fulfillmentRepository.getForOrder(orderId);
export const createFulfillment = (orderId: string) => fulfillmentRepository.createForOrder(orderId);
export const transitionFulfillment = (id: string, status: FulfillmentStatus) => fulfillmentRepository.transition(id, status);
export const assignManualShipment = (id: string, carrier: string, trackingNumber: string, shippingMethod: string) =>
  fulfillmentRepository.assignManualShipment(id, carrier, trackingNumber, shippingMethod);
