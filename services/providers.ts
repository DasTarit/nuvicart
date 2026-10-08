export interface PaymentProvider { createOrder(input: unknown): Promise<unknown>; verifyPayment(input: unknown): Promise<unknown>; handleWebhook(input: unknown): Promise<unknown>; }
export interface ShippingProvider { calculateRates(input: unknown): Promise<unknown>; createShipment(input: unknown): Promise<unknown>; trackShipment(input: unknown): Promise<unknown>; cancelShipment(input: unknown): Promise<unknown>; }
export interface EmailProvider { sendEmail(input: unknown): Promise<unknown>; }
