import type { ReactNode } from "react";
import { SiteShell } from "@/components/storefront/site-shell";
export default function StorefrontLayout({children}:{children:ReactNode}){return <SiteShell>{children}</SiteShell>}
