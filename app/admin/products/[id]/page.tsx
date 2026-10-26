import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { ProductForm } from "@/components/admin/admin-forms";
import { Card } from "@/components/ui/card";
import { PRODUCT_FORM_SELECT, toFormProduct } from "@/lib/admin/product-form-data";

export default async function ProductDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = createAdminClient();
  const [{ data: row, error }, { data: categories }] = await Promise.all([
    db.from("products").select(PRODUCT_FORM_SELECT).eq("id", id).single(),
    db.from("categories").select("id,name").order("name"),
  ]);
  if (error || !row) notFound();
  const product = toFormProduct(row);
  return <main className="p-4 sm:p-6 lg:p-8">
    <p className="text-xs font-semibold uppercase tracking-[.18em] text-primary">Catalog</p>
    <h1 className="mt-2 text-3xl font-semibold">{product.name}</h1>
    <Card className="mt-6 p-5"><ProductForm product={product} categories={categories ?? []} /></Card>
  </main>;
}
