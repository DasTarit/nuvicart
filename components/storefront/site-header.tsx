"use client";
import Link from "next/link";
import { Menu, ShoppingBag, UserRound, Heart, X } from "lucide-react";
import { useState } from "react";
import { useCart } from "@/features/cart/store";
import { useWishlist } from "@/features/wishlist/store";
import { cn } from "@/components/ui/cn";
import { ThemeToggle } from "./theme-toggle";
import { SearchBox } from "./search-box";
import { useEffect } from "react";

export function SiteHeader(){
 const [open,setOpen]=useState(false); const [scrolled,setScrolled]=useState(false);
 useEffect(()=>{const onScroll=()=>setScrolled(window.scrollY>8);onScroll();window.addEventListener("scroll",onScroll,{passive:true});return()=>window.removeEventListener("scroll",onScroll)},[]);
 const {count}=useCart(); const {ids}=useWishlist();

 return <header className={cn("sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80",scrolled&&"shadow-sm")}>
  <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4 sm:px-6 lg:px-8">
   <button type="button" className="rounded-md p-2 md:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="Open menu" onClick={()=>setOpen(true)}><Menu size={21}/></button>
   <Link href="/" className="shrink-0 text-lg font-black tracking-[-0.04em]">NUVI<span className="text-primary">CART</span></Link>
   <nav className="hidden items-center gap-6 md:flex">
    {["Shop","Categories","New Arrivals","Trending","Deals"].map((x,i)=><Link key={x} href={i===1?"/categories":i===4?"/shop?sort=discount":i===2?"/shop?sort=newest":i===3?"/shop?sort=popular":"/shop"} className="text-sm font-medium text-muted transition-colors hover:text-foreground">{x}</Link>)}
   </nav>
   <div className="ml-auto hidden flex-1 md:flex md:justify-center"><SearchBox/></div>
   <div className="ml-auto flex items-center gap-1 md:ml-0"><ThemeToggle/>
    <Link className="hidden p-2 text-muted hover:text-foreground sm:block" href="/account" aria-label="Account"><UserRound size={20}/></Link>
    <Link className="relative p-2 text-muted hover:text-foreground" href="/account/wishlist" aria-label="Wishlist"><Heart size={20}/>{ids.length>0&&<span className="absolute right-0 top-0 grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-[10px] text-primary-foreground">{ids.length}</span>}</Link>
    <Link className="relative p-2 text-muted hover:text-foreground" href="/cart" aria-label="Cart"><ShoppingBag size={20}/>{count>0&&<span className="absolute right-0 top-0 grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-[10px] text-primary-foreground">{count}</span>}</Link>
   </div>
  </div>
  {open&&<div className="fixed inset-0 z-50 bg-background md:hidden"><div className="flex h-16 items-center justify-between border-b px-4"><Link href="/" className="font-black" onClick={()=>setOpen(false)}>NUVICART</Link><button type="button" className="rounded-md p-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={()=>setOpen(false)} aria-label="Close menu"><X/></button></div><nav className="space-y-1 p-5">{[["Shop","/shop"],["Categories","/categories"],["New Arrivals","/shop?sort=newest"],["Trending","/shop?sort=popular"],["Deals","/shop?sort=discount"]].map(([label,href])=><Link key={label} href={href} onClick={()=>setOpen(false)} className="block border-b py-4 text-lg font-semibold">{label}</Link>)}<Link href="/account" className="block border-b py-4 text-lg font-semibold">Account</Link></nav><div className="p-5"><p className="text-xs uppercase tracking-[.18em] text-muted">Everything You Love.</p><p className="mt-1 text-2xl font-semibold">One Cart.</p></div></div>}
 </header>
}
