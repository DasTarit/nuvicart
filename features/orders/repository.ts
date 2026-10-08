import type { Order, OrderSummary } from "./types";

export type CheckoutInput = { addressId: string; idempotencyKey: string; promotionCode?: string | null };

export interface OrderRepository {
  createFromCart(input: CheckoutInput): Promise<OrderSummary>;
  listOrders(): Promise<OrderSummary[]>;
  getOrder(orderNumber: string): Promise<Order | undefined>;
}
