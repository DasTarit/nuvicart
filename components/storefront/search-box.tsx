"use client";

import Image from "next/image";
import { Search } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { Product } from "@/features/catalog";

export function SearchBox(){
  const [q,setQ]=useState("");
  const [suggestions,setSuggestions]=useState<Product[]>([]);

  useEffect(() => {
    const query = q.trim();
    if (!query) { setSuggestions([]); return; }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/catalog/suggestions?q=${encodeURIComponent(query)}`, { signal: controller.signal });
        if (!response.ok) throw new Error("Suggestion request failed");
        const data = await response.json() as { products?: Product[] };
        setSuggestions(Array.isArray(data.products) ? data.products : []);
      } catch {
        if (!controller.signal.aborted) setSuggestions([]);
      }
    }, 180);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [q]);

  return <div className="relative w-full max-w-sm">
    <form action="/search"><label className="sr-only" htmlFor="site-search">Search products</label><div className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" size={17}/><input id="site-search" name="q" value={q} onChange={e=>setQ(e.target.value)} placeholder="Search products, brands, categories..." className="h-10 w-full rounded-full border border-input bg-surface pl-10 pr-4 text-sm outline-none focus:border-primary"/></div></form>
    {q&&<div className="absolute inset-x-0 top-12 z-50 overflow-hidden rounded-2xl border bg-background p-2 shadow-md">
      {suggestions.map(p=><Link key={p.id} href={`/product/${p.slug}`} onClick={()=>setQ("")} className="flex gap-3 rounded-xl p-2 hover:bg-surface-muted"><Image src={p.image} alt="" width={900} height={900} className="h-10 w-10 rounded-lg object-cover"/><span><span className="block text-sm font-medium">{p.name}</span><span className="block text-xs text-muted">{p.brand}</span></span></Link>)}
      {suggestions.length===0&&<p className="p-3 text-sm text-muted">Search Nuvicart</p>}
    </div>}
  </div>
}
