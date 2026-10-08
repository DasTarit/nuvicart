"use client";

import { useEffect, type ReactNode } from "react";
import { useCart } from "@/features/cart/store";
import { useWishlist } from "@/features/wishlist/store";
import type { Product } from "@/features/catalog/types";
import { createClient as createSupabaseBrowserClient } from "@/lib/supabase/client";

const AUTH_KEY = "nuvicart-auth-user";
const SYNC_MARKER = "nuvicart-customer-sync-marker";
const SNAPSHOT_LIMIT = 100;

type RemoteCartItem = { productId: string; variantId: string | null; quantity: number; product: Product };
type CustomerState = {
  authenticated: boolean;
  userId?: string;
  wishlist?: string[];
  cart?: { items?: RemoteCartItem[] };
};

function readGuestCart() {
  try {
    const raw = localStorage.getItem("nuvicart-cart");
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      if (!item?.product?.id || !Number.isInteger(item.quantity) || item.quantity < 1) return [];
      if (item.product.requiresVariantSelection === true) return [];
      return [{ productId: String(item.product.id), variantId: null, quantity: Math.min(item.quantity, 999) }];
    }).slice(0, SNAPSHOT_LIMIT);
  } catch { return []; }
}

function readGuestWishlist() {
  try {
    const raw = localStorage.getItem("nuvicart-wishlist");
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? [...new Set(parsed.filter((id): id is string => typeof id === "string" && id.length > 0))].slice(0, SNAPSHOT_LIMIT) : [];
  } catch { return []; }
}

async function fingerprint(userId: string, cart: unknown, wishlist: unknown) {
  const payload = JSON.stringify({ userId, cart, wishlist });
  const bytes = new TextEncoder().encode(payload);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

export function CustomerSyncProvider({ children }: { children: ReactNode }) {
  const cart = useCart();
  const wishlist = useWishlist();

  useEffect(() => {
    let cancelled = false;
    const sync = async () => {
      try {
        const response = await fetch("/api/customer/state", { cache: "no-store" });
        if (!response.ok) return;
        const state = await response.json() as CustomerState;
        if (cancelled) return;

        if (!state.authenticated || !state.userId) {
          cart.clearForLogout();
          wishlist.clearForLogout();
          sessionStorage.removeItem(AUTH_KEY);
          sessionStorage.removeItem(SYNC_MARKER);
          return;
        }

        const guestCart = readGuestCart();
        const guestWishlist = readGuestWishlist();
        const marker = await fingerprint(state.userId, guestCart, guestWishlist);
        const previous = sessionStorage.getItem(SYNC_MARKER);

        let merged = state;
        if (previous !== `${state.userId}:${marker}`) {
          const syncResponse = await fetch("/api/customer/sync", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ syncToken: marker, wishlist: guestWishlist, cart: guestCart }),
          });
          if (!syncResponse.ok) return;
          merged = await syncResponse.json() as CustomerState;
          sessionStorage.setItem(SYNC_MARKER, `${state.userId}:${marker}`);
        }

        if (cancelled) return;
        sessionStorage.setItem(AUTH_KEY, state.userId);
        const remoteCart = merged.cart?.items ?? [];
        cart.replaceFromCustomerState(remoteCart.map(item => ({ product: item.product, quantity: item.quantity })));
        wishlist.replaceFromCustomerState(merged.wishlist ?? []);
      } catch {
        // Guest state remains untouched, so synchronization can safely retry.
      }
    };
    void sync();
    return () => { cancelled = true; };
    // The synchronization owner runs once per browser mount; store methods are stable setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let client: ReturnType<typeof createSupabaseBrowserClient> | null = null;
    try { client = createSupabaseBrowserClient(); } catch { return; }
    const { data } = client.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        cart.clearForLogout();
        wishlist.clearForLogout();
        sessionStorage.removeItem(AUTH_KEY);
        sessionStorage.removeItem(SYNC_MARKER);
      }
      if (event === "SIGNED_IN") window.location.reload();
    });
    return () => { data.subscription.unsubscribe(); };
    // The listener owns logout/user-switch cleanup; the initial sync above owns first hydration.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <>{children}</>;
}
