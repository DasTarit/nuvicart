import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { mergeCart, getCart, getWishlist, addWishlist } from "@/features/customer/service";
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

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  let body: { syncToken?: unknown; wishlist?: unknown; cart?: unknown } = {};
  try { body = await request.json(); } catch { return NextResponse.json({ error: "INVALID_JSON" }, { status: 400 }); }
  if (typeof body.syncToken !== "string" || !/^[a-f0-9]{64}$/.test(body.syncToken)) {
    return NextResponse.json({ error: "INVALID_SYNC_TOKEN" }, { status: 400 });
  }

  const cookieStore = await cookies();
  const cookieUser = cookieStore.get("nuvicart-sync-user")?.value;
  const cookieToken = cookieStore.get("nuvicart-sync-token")?.value;
  const alreadySynchronized = cookieUser === user.id && cookieToken === body.syncToken;

  if (!alreadySynchronized) {
    const wishlistIds = Array.isArray(body.wishlist)
      ? [...new Set(body.wishlist.filter((id): id is string => typeof id === "string" && id.length > 0))].slice(0, 100)
      : [];
    const cartItems = Array.isArray(body.cart)
      ? body.cart.flatMap((item): Array<{ productId: string; variantId: string | null; quantity: number }> => {
          if (!item || typeof item !== "object") return [];
          const value = item as Record<string, unknown>;
          return typeof value.productId === "string" && Number.isInteger(value.quantity)
            ? [{ productId: value.productId, variantId: typeof value.variantId === "string" ? value.variantId : null, quantity: Number(value.quantity) }]
            : [];
        }).slice(0, 100)
      : [];

    for (const productId of wishlistIds) await addWishlist(productId);
    await mergeCart(cartItems);
  }

  const [wishlist, cart] = await Promise.all([getWishlist(), getCart()]);
  const response = NextResponse.json({ authenticated: true, userId: user.id, ...(await hydrate(wishlist, cart)) });
  response.cookies.set("nuvicart-sync-user", user.id, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/" });
  response.cookies.set("nuvicart-sync-token", body.syncToken, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/" });
  return response;
}
