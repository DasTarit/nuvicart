/* eslint-disable @typescript-eslint/no-explicit-any -- raw Supabase rows are untyped */
/** Shapes a products row (with embedded images / inventory / variants) for ProductForm. */
const one = (v: any) => (Array.isArray(v) ? v[0] ?? null : v ?? null);

export const PRODUCT_FORM_SELECT =
  "*, categories(name), inventory(stock_quantity,reserved_quantity), product_images(url,sort_order,is_primary), product_variants(id)";

export function toFormProduct(row: any) {
  const inv = one(row.inventory);
  const images: string[] = [...(row.product_images ?? [])]
    .sort((a: any, b: any) => a.sort_order - b.sort_order)
    .map((i: any) => String(i.url));
  if (!images.length && row.image_url) images.push(String(row.image_url));
  return {
    id: row.id as string,
    name: row.name as string,
    slug: row.slug as string,
    sku: (row.sku ?? null) as string | null,
    price: row.price,
    compare_at_price: row.compare_at_price ?? null,
    category_id: (row.category_id ?? null) as string | null,
    brand_id: (row.brand_id ?? null) as string | null,
    status: (row.status ?? "active") as string,
    is_active: Boolean(row.is_active),
    short_description: (row.short_description ?? null) as string | null,
    description: (row.description ?? null) as string | null,
    tags: (row.tags ?? []) as string[],
    images,
    stock: inv ? Number(inv.stock_quantity) : 0,
    reserved: inv ? Number(inv.reserved_quantity) : 0,
    hasVariants: (row.product_variants ?? []).length > 0,
  };
}

export type FormProduct = ReturnType<typeof toFormProduct>;
export type CategoryOption = { id: string; name: string };
