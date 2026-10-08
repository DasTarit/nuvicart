import { createClient } from "@/lib/supabase/server";
import type { AddressInput, CartInput, CustomerRepository } from "./repository";
import type { CustomerAddress, CustomerCart, CustomerProfile } from "./types";

async function requireUser() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) throw new Error("UNAUTHENTICATED");
  return { supabase, user };
}

async function resolveProductId(supabase: Awaited<ReturnType<typeof createClient>>, id: string) {
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const query = supabase.from("products").select("id").eq("is_active", true).eq("status", "active");
  const { data, error } = uuidPattern.test(id)
    ? await query.eq("id", id).maybeSingle()
    : await query.eq("legacy_id", id).maybeSingle();
  if (error) throw new Error(`Product validation failed: ${error.message}`);
  return data?.id ?? null;
}

function mapAddress(row: Record<string, unknown>): CustomerAddress {
  return {
    id: String(row.id),
    label: String(row.label),
    fullName: String(row.full_name),
    phone: String(row.phone),
    addressLine1: String(row.address_line_1),
    addressLine2: row.address_line_2 == null ? null : String(row.address_line_2),
    landmark: row.landmark == null ? null : String(row.landmark),
    city: String(row.city),
    state: String(row.state),
    postalCode: String(row.postal_code),
    country: String(row.country),
    isDefault: Boolean(row.is_default),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

async function getOrCreateCart(supabase: Awaited<ReturnType<typeof createClient>>, userId: string) {
  const { data, error } = await supabase.from("carts").upsert({ user_id: userId }, { onConflict: "user_id", ignoreDuplicates: false }).select("id, user_id").single();
  if (error) throw new Error(`Cart query failed: ${error.message}`);
  return data;
}

async function readCart(supabase: Awaited<ReturnType<typeof createClient>>, cartId: string): Promise<CustomerCart> {
  const { data, error } = await supabase.from("cart_items").select("id, product_id, variant_id, quantity").eq("cart_id", cartId).order("created_at", { ascending: true });
  if (error) throw new Error(`Cart items query failed: ${error.message}`);
  return { id: cartId, items: (data ?? []).map((row: { id: string; product_id: string; variant_id: string | null; quantity: number }) => ({ id: row.id, productId: row.product_id, variantId: row.variant_id, quantity: row.quantity })) };
}

export const customerRepository: CustomerRepository = {
  async getProfile() {
    const { supabase, user } = await requireUser();
    const { data, error } = await supabase.from("profiles").select("user_id, display_name, phone, avatar_url, role").eq("user_id", user.id).maybeSingle();
    if (error) throw new Error(`Profile query failed: ${error.message}`);
    if (!data) return null;
    return { userId: data.user_id, email: user.email ?? "", displayName: data.display_name, phone: data.phone, avatarUrl: data.avatar_url, role: data.role };
  },

  async updateProfile(input) {
    const { supabase, user } = await requireUser();
    const patch = {
      ...(input.displayName !== undefined ? { display_name: input.displayName } : {}),
      ...(input.phone !== undefined ? { phone: input.phone } : {}),
      ...(input.avatarUrl !== undefined ? { avatar_url: input.avatarUrl } : {}),
    };
    const { data, error } = await supabase.from("profiles").update(patch).eq("user_id", user.id).select("user_id, display_name, phone, avatar_url, role").single();
    if (error) throw new Error(`Profile update failed: ${error.message}`);
    return { userId: data.user_id, email: user.email ?? "", displayName: data.display_name, phone: data.phone, avatarUrl: data.avatar_url, role: data.role };
  },

  async listAddresses() {
    const { supabase, user } = await requireUser();
    const { data, error } = await supabase.from("customer_addresses").select("*").eq("user_id", user.id).order("is_default", { ascending: false }).order("created_at", { ascending: true });
    if (error) throw new Error(`Address query failed: ${error.message}`);
    return (data ?? []).map(mapAddress);
  },

  async createAddress(input) {
    const { supabase, user } = await requireUser();
    const { data, error } = await supabase.from("customer_addresses").insert({
      user_id: user.id, label: input.label, full_name: input.fullName, phone: input.phone,
      address_line_1: input.addressLine1, address_line_2: input.addressLine2, landmark: input.landmark,
      city: input.city, state: input.state, postal_code: input.postalCode, country: input.country,
      is_default: false,
    }).select("*").single();
    if (error) throw new Error(`Address create failed: ${error.message}`);
    if (input.isDefault) return this.setDefaultAddress(data.id);
    return mapAddress(data);
  },

  async updateAddress(id, input) {
    const { supabase, user } = await requireUser();
    if (input.isDefault) {
      const { data: current, error: findError } = await supabase.from("customer_addresses").select("id").eq("id", id).eq("user_id", user.id).maybeSingle();
      if (findError || !current) throw new Error("Address not found");
      const { data, error } = await supabase.rpc("set_default_customer_address", { p_address_id: id });
      if (error) throw new Error(`Address default update failed: ${error.message}`);
      return mapAddress(data as unknown as Record<string, unknown>);
    }
    const patch: Record<string, unknown> = {};
    const mapping: Record<string, string> = {
      label: "label", fullName: "full_name", phone: "phone", addressLine1: "address_line_1",
      addressLine2: "address_line_2", landmark: "landmark", city: "city", state: "state",
      postalCode: "postal_code", country: "country",
    };
    for (const [key, column] of Object.entries(mapping)) if (key in input) patch[column] = (input as Record<string, unknown>)[key];
    if ("isDefault" in input) patch.is_default = false;
    const { data, error } = await supabase.from("customer_addresses").update(patch).eq("id", id).eq("user_id", user.id).select("*").single();
    if (error) throw new Error(`Address update failed: ${error.message}`);
    return mapAddress(data);
  },

  async deleteAddress(id) {
    const { supabase, user } = await requireUser();
    const { error } = await supabase.from("customer_addresses").delete().eq("id", id).eq("user_id", user.id);
    if (error) throw new Error(`Address delete failed: ${error.message}`);
  },

  async setDefaultAddress(id) {
    const { supabase } = await requireUser();
    const { data, error } = await supabase.rpc("set_default_customer_address", { p_address_id: id });
    if (error) throw new Error(`Address default update failed: ${error.message}`);
    return mapAddress(data as unknown as Record<string, unknown>);
  },

  async getWishlist() {
    const { supabase, user } = await requireUser();
    const { data, error } = await supabase.from("wishlists").select("product_id").eq("user_id", user.id);
    if (error) throw new Error(`Wishlist query failed: ${error.message}`);
    return (data ?? []).map((row: { product_id: string }) => row.product_id);
  },

  async addWishlist(productId) {
    const { supabase, user } = await requireUser();
    const resolvedId = await resolveProductId(supabase, productId);
    if (!resolvedId) return;
    const { error } = await supabase.from("wishlists").upsert({ user_id: user.id, product_id: resolvedId }, { onConflict: "user_id,product_id", ignoreDuplicates: true });
    if (error) throw new Error(`Wishlist update failed: ${error.message}`);
  },

  async removeWishlist(productId) {
    const { supabase, user } = await requireUser();
    const resolvedId = await resolveProductId(supabase, productId);
    if (!resolvedId) return;
    const { error } = await supabase.from("wishlists").delete().eq("user_id", user.id).eq("product_id", resolvedId);
    if (error) throw new Error(`Wishlist update failed: ${error.message}`);
  },

  async getCart() {
    const { supabase, user } = await requireUser();
    const cart = await getOrCreateCart(supabase, user.id);
    return readCart(supabase, cart.id);
  },

  async mergeCart(items) {
    const { supabase, user } = await requireUser();
    const valid = items.filter((item) => Number.isInteger(item.quantity) && item.quantity >= 1).slice(0, 100);
    if (valid.length) {
      const resolvedPairs = await Promise.all(valid.map(async (item) => [item, await resolveProductId(supabase, item.productId)] as const));
      const resolvedProductIds = [...new Set(resolvedPairs.flatMap(([, id]) => id ? [id] : []))];
      const variantIds = [...new Set(valid.map((item) => item.variantId).filter((id): id is string => Boolean(id)))];
      const { data: variants, error: variantError } = await (variantIds.length
        ? supabase.from("product_variants").select("id, product_id").in("id", variantIds).eq("is_active", true)
        : Promise.resolve({ data: [], error: null }));
      if (variantError) throw new Error(`Cart variant validation failed: ${variantError.message}`);
      const variantMap = new Map((variants ?? []).map((v: { id: string; product_id: string }) => [v.id, v.product_id]));
      const { data: activeVariantProducts, error: activeVariantError } = await (resolvedProductIds.length
        ? supabase.from("product_variants").select("product_id").in("product_id", resolvedProductIds).eq("is_active", true)
        : Promise.resolve({ data: [], error: null }));
      if (activeVariantError) throw new Error(`Cart variant requirement check failed: ${activeVariantError.message}`);
      const productsRequiringVariant = new Set((activeVariantProducts ?? []).map((row: { product_id: string }) => row.product_id));
      const clean = resolvedPairs.flatMap(([item, resolvedId]) => {
        if (!resolvedId) return [];
        if (item.variantId && variantMap.get(item.variantId) !== resolvedId) return [];
        if (!item.variantId && productsRequiringVariant.has(resolvedId)) return [];
        return [{ ...item, productId: resolvedId }];
      });
      const cart = await getOrCreateCart(supabase, user.id);
      const existing = await readCart(supabase, cart.id);
      const merged = new Map(existing.items.map((item) => [`${item.productId}:${item.variantId ?? ""}`, item.quantity]));
      for (const item of clean) {
        const key = `${item.productId}:${item.variantId ?? ""}`;
        merged.set(key, Math.min((merged.get(key) ?? 0) + item.quantity, 999));
      }
      for (const [key, quantity] of merged) {
        const [productId, variantId] = key.split(":");
        let query = supabase.from("cart_items").select("id").eq("cart_id", cart.id).eq("product_id", productId);
        query = variantId ? query.eq("variant_id", variantId) : query.is("variant_id", null);
        const { data: existing, error: findError } = await query.maybeSingle();
        if (findError) throw new Error(`Cart merge lookup failed: ${findError.message}`);
        if (existing) {
          const { error } = await supabase.from("cart_items").update({ quantity }).eq("id", existing.id);
          if (error) throw new Error(`Cart merge failed: ${error.message}`);
        } else {
          const { error } = await supabase.from("cart_items").insert({ cart_id: cart.id, product_id: productId, variant_id: variantId || null, quantity });
          if (error) throw new Error(`Cart merge failed: ${error.message}`);
        }
      }
      return readCart(supabase, cart.id);
    }
    return this.getCart();
  },

  async setCartItem(input) {
    const { supabase, user } = await requireUser();
    if (!Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > 999) throw new Error("Invalid cart quantity");
    const resolvedProductId = await resolveProductId(supabase, input.productId);
    if (!resolvedProductId) throw new Error("Product is unavailable");
    if (input.variantId) {
      const variant = await supabase.from("product_variants").select("id").eq("id", input.variantId).eq("product_id", resolvedProductId).eq("is_active", true).maybeSingle();
      if (variant.error) throw new Error(`Cart variant validation failed: ${variant.error.message}`);
      if (!variant.data) throw new Error("Variant is unavailable");
    } else {
      const activeVariant = await supabase.from("product_variants").select("id").eq("product_id", resolvedProductId).eq("is_active", true).limit(1).maybeSingle();
      if (activeVariant.error) throw new Error(`Cart variant requirement check failed: ${activeVariant.error.message}`);
      if (activeVariant.data) throw new Error("Variant selection required");
    }
    const cart = await getOrCreateCart(supabase, user.id);
    let existingQuery = supabase.from("cart_items").select("id").eq("cart_id", cart.id).eq("product_id", resolvedProductId);
    existingQuery = input.variantId ? existingQuery.eq("variant_id", input.variantId) : existingQuery.is("variant_id", null);
    const { data: existing, error: findError } = await existingQuery.maybeSingle();
    if (findError) throw new Error(`Cart lookup failed: ${findError.message}`);
    const mutation = existing
      ? supabase.from("cart_items").update({ quantity: input.quantity }).eq("id", existing.id)
      : supabase.from("cart_items").insert({ cart_id: cart.id, product_id: resolvedProductId, variant_id: input.variantId ?? null, quantity: input.quantity });
    const { error } = await mutation;
    if (error) throw new Error(`Cart update failed: ${error.message}`);
    return readCart(supabase, cart.id);
  },

  async removeCartItem(productId, variantId) {
    const { supabase, user } = await requireUser();
    const cart = await getOrCreateCart(supabase, user.id);
    const resolvedProductId = await resolveProductId(supabase, productId);
    if (!resolvedProductId) return readCart(supabase, cart.id);
    let query = supabase.from("cart_items").delete().eq("cart_id", cart.id).eq("product_id", resolvedProductId);
    query = variantId ? query.eq("variant_id", variantId) : query.is("variant_id", null);
    const { error } = await query;
    if (error) throw new Error(`Cart removal failed: ${error.message}`);
    return readCart(supabase, cart.id);
  },

  async clearCart() {
    const { supabase, user } = await requireUser();
    const cart = await getOrCreateCart(supabase, user.id);
    const { error } = await supabase.from("cart_items").delete().eq("cart_id", cart.id);
    if (error) throw new Error(`Cart clear failed: ${error.message}`);
  },
};
