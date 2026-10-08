import { orderRepository } from "./supabase-repository";
import type { CheckoutInput } from "./repository";

export const createOrderFromCart = (input: CheckoutInput) => orderRepository.createFromCart(input);
export const listOrders = () => orderRepository.listOrders();
export const getOrder = (orderNumber: string) => orderRepository.getOrder(orderNumber);
