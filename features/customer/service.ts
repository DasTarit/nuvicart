import { customerRepository } from "./supabase-repository";
import type { AddressInput, CartInput } from "./repository";

export const getProfile = () => customerRepository.getProfile();
export const updateProfile = (input: { displayName?: string | null; phone?: string | null; avatarUrl?: string | null }) => customerRepository.updateProfile(input);
export const listAddresses = () => customerRepository.listAddresses();
export const createAddress = (input: AddressInput) => customerRepository.createAddress(input);
export const updateAddress = (id: string, input: Partial<AddressInput>) => customerRepository.updateAddress(id, input);
export const deleteAddress = (id: string) => customerRepository.deleteAddress(id);
export const setDefaultAddress = (id: string) => customerRepository.setDefaultAddress(id);
export const getWishlist = () => customerRepository.getWishlist();
export const addWishlist = (productId: string) => customerRepository.addWishlist(productId);
export const removeWishlist = (productId: string) => customerRepository.removeWishlist(productId);
export const getCart = () => customerRepository.getCart();
export const mergeCart = (items: CartInput[]) => customerRepository.mergeCart(items);
export const setCartItem = (input: CartInput) => customerRepository.setCartItem(input);
export const removeCartItem = (productId: string, variantId?: string | null) => customerRepository.removeCartItem(productId, variantId);
export const clearCart = () => customerRepository.clearCart();
