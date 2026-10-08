"use client";

import Image from "next/image";
import { useState } from "react";
import { Heart, Share2, ShoppingBag, Star, Truck, RotateCcw, ShieldCheck, Minus, Plus } from "lucide-react";
import type { Product } from "@/features/catalog";
import { useCart } from "@/features/cart/store";
import { useWishlist } from "@/features/wishlist/store";
import { ProductGrid } from "./product-grid";

export function ProductPageClient({ product, related, discount }: { product: Product; related: Product[]; discount: number }) {
  const [qty, setQty] = useState(product.stock > 0 ? 1 : 0);
  const [added, setAdded] = useState(false);
  const [shareState, setShareState] = useState<"idle" | "success" | "error">("idle");
  const { add } = useCart();
  const { has, toggle } = useWishlist();
  const unavailable = product.stock <= 0;
  const requiresVariant = product.requiresVariantSelection;

  const addToCart = () => {
    if (unavailable || requiresVariant || qty < 1) return;
    for (let i = 0; i < qty; i += 1) add(product);
    setAdded(true);
    window.setTimeout(() => setAdded(false), 1200);
  };

  const share = async () => {
    try {
      if (navigator.share) {
        await navigator.share({ title: product.name, text: product.description, url: window.location.href });
      } else {
        await navigator.clipboard.writeText(window.location.href);
      }
      setShareState("success");
    } catch {
      setShareState("error");
    }
    window.setTimeout(() => setShareState("idle"), 2200);
  };

  return <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
    <div className="text-xs text-muted">Home / {product.category} / {product.name}</div>
    <div className="mt-8 grid gap-10 lg:grid-cols-2">
      <div className="grid gap-3 sm:grid-cols-[90px_1fr]">
        <div className="order-2 flex gap-3 overflow-auto sm:order-1 sm:flex-col">
          <Image src={product.image} alt={`${product.name} primary view`} width={900} height={900} className="h-20 w-20 shrink-0 rounded-xl object-cover ring-2 ring-primary" />
          <Image src={product.secondaryImage} alt={`${product.name} alternate view`} width={900} height={900} className="h-20 w-20 shrink-0 rounded-xl object-cover" />
        </div>
        <div className="order-1 aspect-square overflow-hidden rounded-[2rem] bg-surface-muted sm:order-2">
          <Image src={product.image} alt={product.name} width={900} height={900} className="h-full w-full object-cover" priority />
        </div>
      </div>
      <div className="lg:pt-6">
        <p className="text-sm text-muted">{product.brand}</p>
        <h1 className="mt-2 text-4xl font-semibold tracking-tight">{product.name}</h1>
        <div className="mt-4 flex items-center gap-2 text-sm"><Star size={15} fill="currentColor" aria-hidden="true" />{product.rating} <span className="text-muted">({product.reviews} reviews)</span></div>
        <div className="mt-7 flex items-end gap-3"><span className="text-3xl font-semibold">₹{product.price.toLocaleString("en-IN")}</span>{product.originalPrice && <><span className="text-muted line-through">₹{product.originalPrice.toLocaleString("en-IN")}</span><span className="font-medium text-success">{discount}% off</span></>}</div>
        <p className="mt-6 leading-7 text-muted">{product.description}</p>
        <p className="mt-5 text-sm font-medium">{unavailable ? "Out of stock" : `${product.stock} in stock`}</p>
        <div className="mt-7 flex flex-wrap items-center gap-2">
          <div className="flex items-center rounded-full border" aria-label="Quantity">
            <button type="button" disabled={unavailable || qty <= 1} className="p-3 disabled:opacity-40" onClick={() => setQty(Math.max(1, qty - 1))} aria-label="Decrease quantity"><Minus size={15} /></button>
            <span className="w-8 text-center text-sm" aria-live="polite">{qty}</span>
            <button type="button" disabled={unavailable || qty >= product.stock} className="p-3 disabled:opacity-40" onClick={() => setQty(Math.min(product.stock, qty + 1))} aria-label="Increase quantity"><Plus size={15} /></button>
          </div>
          <button type="button" disabled={unavailable || requiresVariant} onClick={addToCart} className="flex h-11 min-w-44 flex-1 items-center justify-center gap-2 rounded-full bg-primary px-5 font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"><ShoppingBag size={17} />{unavailable ? "Out of stock" : requiresVariant ? "Select options" : added ? "Added to cart" : "Add to Cart"}</button>
          <button type="button" onClick={() => toggle(product.id)} className="grid h-11 w-11 place-items-center rounded-full border" aria-label={has(product.id) ? "Remove from wishlist" : "Add to wishlist"}><Heart size={18} fill={has(product.id) ? "currentColor" : "none"} /></button>
          <button type="button" onClick={share} className="grid h-11 w-11 place-items-center rounded-full border" aria-label="Share product"><Share2 size={18} /></button>
        </div>
        {requiresVariant && !unavailable && <p className="mt-2 text-xs text-muted">Select a product option before adding this item to your cart.</p>}
        {shareState !== "idle" && <p role="status" className={`mt-2 text-xs ${shareState === "success" ? "text-success" : "text-error"}`}>{shareState === "success" ? "Product link shared or copied." : "We couldn't share the product link."}</p>}
        <div className="mt-8 grid gap-3 border-y py-6 sm:grid-cols-3">{[[Truck, "Fast delivery"], [RotateCcw, "Easy returns"], [ShieldCheck, "Secure checkout"]].map(([I, t]) => { const Icon = I as typeof Truck; return <div key={t as string} className="flex items-center gap-3 text-sm"><Icon size={18} aria-hidden="true" /><span>{t as string}</span></div>; })}</div>
      </div>
    </div>
    <section className="mt-20 grid gap-8 border-t pt-12 md:grid-cols-3">
      <div><h2 className="font-semibold">Description</h2><p className="mt-3 text-sm leading-7 text-muted">{product.description} Designed to balance thoughtful details, reliable everyday performance and a finish that belongs in a modern space.</p></div>
      <div><h2 className="font-semibold">Specifications</h2><ul className="mt-3 space-y-2 text-sm text-muted"><li>Brand: {product.brand}</li><li>Category: {product.category}</li><li>Availability: {unavailable ? "Out of stock" : "In stock"}</li></ul></div>
      <div><h2 className="font-semibold">Shipping & returns</h2><p className="mt-3 text-sm leading-7 text-muted">Delivery, payment and return policies will be connected to production services in later phases.</p></div>
    </section>
    {related.length > 0 && <section className="mt-20 border-t pt-12"><div className="mb-8"><p className="text-xs font-semibold uppercase tracking-[.18em] text-primary">You may also like</p><h2 className="mt-2 text-3xl font-semibold">More from {product.category}.</h2></div><ProductGrid products={related} /></section>}
  </main>;
}
