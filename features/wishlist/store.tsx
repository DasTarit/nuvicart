"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

type WishlistContext = {
  ids: string[];
  has: (id: string) => boolean;
  toggle: (id: string) => void;
  replaceFromCustomerState: (ids: string[]) => void;
  clearForLogout: () => void;
};
const STORAGE_KEY = "nuvicart-wishlist";
const AUTH_KEY = "nuvicart-auth-user";
const C = createContext<WishlistContext | null>(null);

function sanitize(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((id): id is string => typeof id === "string" && id.length > 0))].slice(0, 100);
}

export function WishlistProvider({ children }: { children: ReactNode }) {
  const [ids, setIds] = useState<string[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setIds(sanitize(JSON.parse(raw)));
    } catch { localStorage.removeItem(STORAGE_KEY); }
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(ids)); } catch { /* storage can be unavailable */ }
  }, [ids, ready]);

  const value = useMemo(() => ({
    ids,
    has: (id: string) => ids.includes(id),
    replaceFromCustomerState: (nextIds: string[]) => {
      setIds(sanitize(nextIds));
    },
    clearForLogout: () => {
      setIds([]);
      try { localStorage.removeItem(STORAGE_KEY); } catch { /* storage unavailable */ }
    },
    toggle: (id: string) => {
      setIds(current => {
        const next = current.includes(id) ? current.filter(x => x !== id) : [...current, id].slice(-100);
        if (sessionStorage.getItem(AUTH_KEY)) {
          void fetch("/api/customer/wishlist", {
            method: next.includes(id) ? "POST" : "DELETE",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ productId: id }),
          }).catch(() => {});
        }
        return next;
      });
    },
  }), [ids]);

  return <C.Provider value={value}>{children}</C.Provider>;
}

export function useWishlist() {
  const value = useContext(C);
  if (!value) throw new Error("useWishlist must be used inside WishlistProvider");
  return value;
}
