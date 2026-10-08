import type { Metadata } from "next";
export const metadata: Metadata = { robots: { index: false, follow: false } };
import Link from "next/link";
import type { ReactNode } from "react";
import { requireAdminPage } from "@/lib/auth/admin";
import { GlobalSearch } from "@/components/admin/global-search";

const links = [
  ["Dashboard","/admin"],["Analytics","/admin/analytics"],["Promotions","/admin/promotions"],["Orders","/admin/orders"],["Products","/admin/products"],["Categories","/admin/categories"],
  ["Inventory","/admin/inventory"],["Customers","/admin/customers"],["Fulfillment / Shipping","/admin/shipping"],
  ["Payments","/admin/payments"],["Notifications","/admin/notifications"],["Audit Log","/admin/audit"],["Settings","/admin/settings"],
] as const;

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const { role } = await requireAdminPage();
  return <div className="min-h-screen bg-surface-muted">
    <div className="mx-auto flex min-h-screen max-w-[1600px]">
      <aside className="hidden w-64 shrink-0 border-r border-border bg-surface p-5 lg:block">
        <Link href="/admin" className="text-xl font-bold">Nuvicart <span className="text-primary">Admin</span></Link>
        <p className="mt-1 text-xs text-muted">{role === "super_admin" ? "Super admin" : "Admin"} operations</p>
        <nav className="mt-8 space-y-1">
          {links.map(([label,href]) => <Link key={href} href={href} className="block rounded-lg px-3 py-2 text-sm font-medium hover:bg-surface-muted">{label}</Link>)}
        </nav>
      </aside>
      <div className="min-w-0 flex-1">
        <div className="hidden items-center justify-end border-b border-border bg-surface px-6 py-3 lg:flex"><GlobalSearch /></div>
        <header className="sticky top-0 z-20 border-b border-border bg-surface/95 px-4 py-3 backdrop-blur lg:hidden">
          <div className="flex items-center justify-between gap-3">
            <Link href="/admin" className="font-bold">Nuvicart Admin</Link>
            <nav className="flex max-w-[70vw] gap-2 overflow-x-auto text-xs">{links.map(([label,href]) => <Link key={href} href={href} className="whitespace-nowrap rounded-md border px-2 py-1">{label}</Link>)}</nav>
          </div>
        </header>
        {children}
      </div>
    </div>
  </div>;
}
