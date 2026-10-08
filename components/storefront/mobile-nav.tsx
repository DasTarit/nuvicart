"use client";
import Link from "next/link";
import { Home, LayoutGrid, Search, Heart, UserRound } from "lucide-react";
export function MobileNav(){return <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t bg-background/95 px-2 py-2 backdrop-blur md:hidden">{[[Home,"Home","/"],[LayoutGrid,"Categories","/categories"],[Search,"Search","/search"],[Heart,"Wishlist","/account/wishlist"],[UserRound,"Account","/account"]].map(([Icon,label,href])=>{const I=Icon as typeof Home;return <Link key={label as string} href={href as string} className="flex flex-col items-center gap-1 py-1 text-[10px] text-muted hover:text-foreground"><I size={18} aria-hidden="true" />{label as string}</Link>})}</nav>}
