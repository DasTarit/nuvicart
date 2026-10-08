import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCheckoutPreview } from "@/features/orders/checkout";
import { CheckoutReview } from "@/components/storefront/checkout-review";

export default async function Checkout() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/checkout");

  try {
    const { preview, addresses } = await getCheckoutPreview();
    return <main className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8"><p className="text-xs font-semibold uppercase tracking-[.18em] text-primary">Checkout review</p><h1 className="mt-2 text-4xl font-semibold tracking-tight">Review your order.</h1><p className="mt-2 text-sm text-muted">Prices, availability and totals below are calculated from the production catalog on the server.</p><div className="mt-10"><CheckoutReview preview={preview} addresses={addresses} /></div></main>;
  } catch (error) {
    const message = error instanceof Error && error.message === "EMPTY_CART" ? "Your cart is empty." : "Some cart information is no longer available. Please review your cart and try again.";
    return <main className="mx-auto max-w-2xl px-4 py-20 text-center sm:px-6"><p className="text-xs font-semibold uppercase tracking-[.18em] text-primary">Checkout review</p><h1 className="mt-3 text-4xl font-semibold">We need to refresh your cart.</h1><p className="mx-auto mt-4 max-w-lg text-sm leading-7 text-muted">{message}</p><a href="/cart" className="mt-7 inline-flex rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground">Back to cart</a></main>;
  }
}
