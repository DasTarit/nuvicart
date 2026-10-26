/* eslint-disable @typescript-eslint/no-explicit-any -- raw Supabase rows are untyped */
import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { AddProductDialog } from "@/components/admin/add-product-dialog";
import { ProductRowActions } from "@/components/admin/product-row-actions";
import { Card } from "@/components/ui/card";
import { PRODUCT_FORM_SELECT, toFormProduct } from "@/lib/admin/product-form-data";

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);

export default async function ProductsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const q = ((await searchParams).q ?? "").replace(/[,%()]/g, " ").trim();
  const db = createAdminClient();

  let query = db.from("products").select(PRODUCT_FORM_SELECT).order("created_at", { ascending: false }).limit(100);
  if (q) query = query.or(`name.ilike.%${q}%,sku.ilike.%${q}%,slug.ilike.%${q}%`);

  const [productsRes, categoriesRes] = await Promise.all([query, db.from("categories").select("id,name").order("name")]);
  const rows = (productsRes.data ?? []) as any[];
  const categories = categoriesRes.data ?? [];
  const error = productsRes.error ?? categoriesRes.error;

  return <main className="p-4 sm:p-6 lg:p-8">
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[.18em] text-primary">Catalog</p>
        <h1 className="mt-2 text-3xl font-semibold">Products</h1>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <form><input name="q" defaultValue={q} placeholder="Search name, SKU or slug" className="rounded-lg border bg-surface px-3 py-2 text-sm" /></form>
        <AddProductDialog categories={categories} />
      </div>
    </div>

    {error && <p role="alert" className="mt-6 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">Could not load products: {error.message}</p>}

    <Card className="mt-6 overflow-x-auto">
      <table className="w-full min-w-[950px] text-left text-sm">
        <thead className="bg-surface-muted"><tr>{["Product", "SKU", "Category", "Price", "Status", "Available", "Visibility", "Actions"].map((h) => <th key={h} className="px-4 py-3">{h}</th>)}</tr></thead>
        <tbody>
          {rows.map((row) => {
            const p = toFormProduct(row);
            return <tr key={p.id} className="border-t">
              <td className="px-4 py-3">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 shrink-0 overflow-hidden rounded-md border bg-surface-muted">
                    {p.images[0] && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.images[0]} alt="" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
                    )}
                  </div>
                  <Link className="font-medium underline-offset-4 hover:underline" href={`/admin/products/${p.id}`}>{p.name}</Link>
                </div>
              </td>
              <td className="px-4 py-3">{p.sku ?? "—"}</td>
              <td className="px-4 py-3">{one<any>(row.categories)?.name ?? "—"}</td>
              <td className="px-4 py-3">₹{Number(p.price).toFixed(2)}</td>
              <td className="px-4 py-3">{p.status}</td>
              <td className="px-4 py-3">{p.hasVariants ? "per variant" : p.stock - p.reserved}</td>
              <td className="px-4 py-3">{p.is_active ? "Active" : "Inactive"}</td>
              <td className="px-4 py-3"><ProductRowActions product={p} categories={categories} /></td>
            </tr>;
          })}
          {!rows.length && !error && <tr><td colSpan={8} className="px-4 py-10 text-center text-muted">{q ? `No products match “${q}”.` : "No products yet. Click “+ Add product” to create your first one."}</td></tr>}
        </tbody>
      </table>
    </Card>
  </main>;
}
