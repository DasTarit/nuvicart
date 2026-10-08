"use client";
import Image from "next/image"; import Link from "next/link";
import { Heart, ShoppingBag, Eye, Star } from "lucide-react";
import { useState } from "react";
import type { Product } from "@/features/catalog";
import { discount } from "@/features/catalog";
import { useCart } from "@/features/cart/store";
import { useWishlist } from "@/features/wishlist/store";
import { cn } from "@/components/ui/cn";

export function ProductCard({product,onQuickView}:{product:Product;onQuickView?:(p:Product)=>void}){
 const {add}=useCart(); const {has,toggle}=useWishlist(); const [added,setAdded]=useState(false);
 const wish=has(product.id);
 return <article className="group relative">
  <div className="relative aspect-[4/5] overflow-hidden rounded-2xl bg-surface-muted">
   <Link href={`/product/${product.slug}`} className="block h-full"><Image src={product.image} alt={product.name} width={900} height={900} className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.035]"/><Image src={product.secondaryImage} alt="" aria-hidden width={900} height={900} className="absolute inset-0 h-full w-full object-cover opacity-0 transition duration-500 group-hover:opacity-100 group-hover:scale-[1.035]"/></Link>
   {product.badge&&<span className="absolute left-3 top-3 rounded-full bg-background/90 px-2.5 py-1 text-[11px] font-semibold">{product.badge}</span>}
   <button onClick={()=>toggle(product.id)} aria-label={wish?"Remove from wishlist":"Add to wishlist"} className={cn("absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-full bg-background/90 backdrop-blur transition",wish&&"text-primary")}><Heart size={17} fill={wish?"currentColor":"none"}/></button>
   <div className="absolute inset-x-3 bottom-3 flex translate-y-2 gap-2 opacity-0 transition group-hover:translate-y-0 group-hover:opacity-100 max-sm:translate-y-0 max-sm:opacity-100">
    <button onClick={()=>onQuickView?.(product)} className="grid h-10 flex-1 place-items-center rounded-full bg-background/95 text-sm font-medium shadow-sm"><Eye size={16} className="mr-2"/>Quick view</button>
    {product.requiresVariantSelection ? (
      <Link href={`/product/${product.slug}`} className="grid h-10 w-10 place-items-center rounded-full bg-primary text-primary-foreground shadow-sm" aria-label="Select options"><ShoppingBag size={17}/></Link>
    ) : (
      <button onClick={() => { if (product.stock > 0) { add(product); setAdded(true); setTimeout(() => setAdded(false), 900); } }} disabled={product.stock <= 0} aria-disabled={product.stock <= 0}
        className="grid h-10 w-10 place-items-center rounded-full bg-primary text-primary-foreground shadow-sm disabled:cursor-not-allowed disabled:opacity-40" aria-label={product.stock > 0 ? "Add to cart" : "Out of stock"}><ShoppingBag size={17}/></button>
    )}
   </div>
  </div>
  <div className="pt-4"><p className="text-xs text-muted">{product.brand}</p><Link href={`/product/${product.slug}`} className="mt-1 block font-medium hover:underline">{product.name}</Link><div className="mt-2 flex items-center justify-between"><div className="flex items-center gap-1 text-xs"><Star size={13} fill="currentColor"/>{product.rating} <span className="text-muted">({product.reviews})</span></div><div className="text-right"><span className="font-semibold">₹{product.price.toLocaleString("en-IN")}</span>{product.originalPrice&&<span className="ml-2 text-xs text-muted line-through">₹{product.originalPrice.toLocaleString("en-IN")}</span>}</div></div>{product.originalPrice&&<p className="mt-1 text-xs font-medium text-success">{discount(product)}% off</p>}{added&&<p className="mt-2 text-xs font-medium text-success">Added to cart</p>}</div>
 </article>
}
