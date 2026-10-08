"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Product } from "@/features/catalog/types";

type CartItem = { product: Product; quantity: number };
type RemoteCartItem = { product: Product; quantity: number };
type CartContextValue = {
  items: CartItem[];
  count: number;
  subtotal: number;
  add: (product: Product) => void;
  remove: (id: string) => void;
  setQuantity: (id: string, quantity: number) => void;
  clear: () => void;
  replaceFromCustomerState: (items: RemoteCartItem[]) => void;
  clearForLogout: () => void;
};
const STORAGE_KEY = "nuvicart-cart";
const AUTH_KEY = "nuvicart-auth-user";
const CartContext = createContext<CartContextValue | null>(null);

function sanitize(value: unknown): CartItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): CartItem[] => {
    if (!item || typeof item !== "object") return [];
    const candidate = item as Partial<CartItem>;
    const product = candidate.product;
    if (!product || typeof product !== "object" || typeof product.id !== "string" || typeof product.price !== "number") return [];
    if (product.requiresVariantSelection) return [];
    const stock = Number(product.stock);
    if (!Number.isFinite(stock) || stock <= 0) return [];
    const quantity = Number(candidate.quantity);
    if (!Number.isFinite(quantity) || quantity < 1) return [];
    return [{ product: product as Product, quantity: Math.min(Math.floor(quantity), stock) }];
  });
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setItems(sanitize(JSON.parse(raw)));
    } catch { localStorage.removeItem(STORAGE_KEY); }
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(items)); } catch { /* storage can be unavailable */ }
  }, [items, ready]);

  const value = useMemo<CartContextValue>(() => ({
    items,
    count: items.reduce((sum, item) => sum + item.quantity, 0),
    subtotal: items.reduce((sum, item) => sum + item.product.price * item.quantity, 0),
    replaceFromCustomerState: (remote) => {
      setItems(sanitize(remote));
    },
    clearForLogout: () => {
      setItems([]);
      try { localStorage.removeItem(STORAGE_KEY); } catch { /* storage unavailable */ }
    },
    add: (product) => {
      if (product.stock <= 0 || product.requiresVariantSelection) return;
      setItems(current => {
        const found = current.find(item => item.product.id === product.id);
        const quantity = found ? Math.min(found.quantity + 1, product.stock) : 1;
        if (sessionStorage.getItem(AUTH_KEY)) void fetch("/api/customer/cart", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ productId: product.id, quantity }),
        }).catch(() => {});
        return found ? current.map(item => item.product.id === product.id ? { ...item, product, quantity } : item) : [...current, { product, quantity }];
      });
    },
    remove: (id) => {
      setItems(current => current.filter(item => item.product.id !== id));
      if (sessionStorage.getItem(AUTH_KEY)) void fetch("/api/customer/cart", { method:"DELETE", headers:{"content-type":"application/json"}, body:JSON.stringify({productId:id}) }).catch(() => {});
    },
    setQuantity: (id, quantity) => setItems(current => current.flatMap(item => {
      if (item.product.id !== id) return [item];
      if (item.product.stock <= 0) return [];
      if (!Number.isFinite(quantity) || !Number.isInteger(quantity)) return [item];
      const nextQuantity = Math.max(1, Math.min(quantity, item.product.stock));
      if (sessionStorage.getItem(AUTH_KEY)) void fetch("/api/customer/cart", { method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify({productId:id,quantity:nextQuantity}) }).catch(() => {});
      return [{ ...item, quantity: nextQuantity }];
    })),
    clear: () => {
      setItems([]);
      if (sessionStorage.getItem(AUTH_KEY)) void fetch("/api/customer/cart", { method:"PUT" }).catch(() => {});
    },
  }), [items]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used inside CartProvider");
  return ctx;
}
