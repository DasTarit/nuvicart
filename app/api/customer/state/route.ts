import { NextResponse } from "next/server";
import { getCart, getWishlist } from "@/features/customer/service";
import { createClient } from "@/lib/supabase/server";
import { supabaseRepository } from "@/features/catalog/supabase-repository";

async function hydrate(wishlistIds: string[], cart: Awaited<ReturnType<typeof getCart>>) {
  const [wishlistProducts, cartProducts] = await Promise.all([
    supabaseRepository.getProductsByIds(wishlistIds),
    supabaseRepository.getProductsByIds(cart.items.map(item => item.productId)),
  ]);
  const productMap = new Map<string, typeof cartProducts[number]>();
  for (const product of cartProducts) productMap.set(product.catalogId ?? product.id, product);
  return {
    wishlist: wishlistProducts.map(product => product.id),
    cart: {
      id: cart.id,
      items: cart.items.flatMap(item => {
        const product = productMap.get(item.productId);
        return product ? [{ productId: product.id, variantId: item.variantId, quantity: item.quantity, product }] : [];
      }),
    },
  };
}

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ authenticated: false });
  const [wishlist, cart] = await Promise.all([getWishlist(), getCart()]);
  return NextResponse.json({ authenticated: true, userId: user.id, ...(await hydrate(wishlist, cart)) });
}
