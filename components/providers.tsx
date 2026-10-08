"use client";
import type {ReactNode} from "react";
import {CartProvider} from "@/features/cart/store";
import {WishlistProvider} from "@/features/wishlist/store";
import {CustomerSyncProvider} from "@/components/providers/customer-sync-provider";
export function Providers({children}:{children:ReactNode}){return <CartProvider><WishlistProvider><CustomerSyncProvider>{children}</CustomerSyncProvider></WishlistProvider></CartProvider>}
