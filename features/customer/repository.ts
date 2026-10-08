import type { CustomerAddress, CustomerCart, CustomerProfile } from "./types";

export type AddressInput = Omit<CustomerAddress, "id" | "createdAt" | "updatedAt" | "isDefault"> & { isDefault?: boolean };
export type CartInput = { productId: string; variantId?: string | null; quantity: number };

export interface CustomerRepository {
  getProfile(): Promise<CustomerProfile | null>;
  updateProfile(input: { displayName?: string | null; phone?: string | null; avatarUrl?: string | null }): Promise<CustomerProfile>;
  listAddresses(): Promise<CustomerAddress[]>;
  createAddress(input: AddressInput): Promise<CustomerAddress>;
  updateAddress(id: string, input: Partial<AddressInput>): Promise<CustomerAddress>;
  deleteAddress(id: string): Promise<void>;
  setDefaultAddress(id: string): Promise<CustomerAddress>;
  getWishlist(): Promise<string[]>;
  addWishlist(productId: string): Promise<void>;
  removeWishlist(productId: string): Promise<void>;
  getCart(): Promise<CustomerCart>;
  mergeCart(items: CartInput[]): Promise<CustomerCart>;
  setCartItem(input: CartInput): Promise<CustomerCart>;
  removeCartItem(productId: string, variantId?: string | null): Promise<CustomerCart>;
  clearCart(): Promise<void>;
}
