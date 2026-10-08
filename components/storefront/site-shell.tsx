import type { ReactNode } from "react";
import { SiteHeader } from "./site-header";
import { Footer } from "./footer";
import { MobileNav } from "./mobile-nav";

export function SiteShell({children}:{children:ReactNode}){return <><SiteHeader/><div className="pb-16 md:pb-0">{children}</div><Footer/><MobileNav/></>}
