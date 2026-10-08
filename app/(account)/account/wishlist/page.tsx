"use client";

import { useEffect, useState } from "react";
import type { Product } from "@/features/catalog";
import { ProductGrid } from "@/components/storefront/product-grid";
import { useWishlist } from "@/features/wishlist/store";

export default function Wishlist(){
  const {ids}=useWishlist();
  const [products,setProducts]=useState<Product[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    if (!ids.length) { setProducts([]); return () => controller.abort(); }
    fetch(`/api/catalog/products?ids=${encodeURIComponent(ids.join(","))}`, { signal: controller.signal })
      .then((response) => response.ok ? response.json() as Promise<{ products?: Product[] }> : Promise.reject(new Error("Wishlist request failed")))
      .then((data) => setProducts(Array.isArray(data.products) ? data.products : []))
      .catch(() => { if (!controller.signal.aborted) setProducts([]); });
    return () => controller.abort();
  }, [ids]);

  return <section><h2 className="text-2xl font-semibold">Wishlist</h2><p className="mt-1 text-sm text-muted">Save products you want to come back to.</p><div className="mt-8">{products.length?<ProductGrid products={products}/>:<div className="rounded-2xl border p-12 text-center"><p className="font-medium">Save something you love.</p><p className="mt-2 text-sm text-muted">Tap the heart on a product to keep it here.</p></div>}</div></section>
}
