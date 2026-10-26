"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { CategoryOption, FormProduct } from "@/lib/admin/product-form-data";

const ERRORS: Record<string, string> = {
  INVALID_PRODUCT_INPUT: "Some fields are invalid. Check the name, slug (lowercase-with-dashes) and price.",
  INVALID_PRODUCT_SLUG: "Slug must be lowercase letters, numbers and dashes, e.g. blue-t-shirt.",
  INVALID_COMPARE_AT_PRICE: "Compare-at price must be equal to or higher than the price.",
  INVALID_INITIAL_STOCK: "Stock must be 0 or more.",
  INVALID_STOCK: "Stock must be 0 or more.",
  PRODUCT_NEEDS_TWO_IMAGES: "Add at least 2 different image links.",
  INVALID_IMAGE_URL: "One of the image links is not valid. Links must start with https://",
  TOO_MANY_IMAGES: "You can add at most 10 images.",
  STOCK_BELOW_RESERVED: "Stock can’t be lower than the units already reserved by customers’ pending orders.",
  STOCK_MANAGED_BY_VARIANTS: "This product has variants — change stock per variant on the Inventory page.",
  PRODUCT_NOT_FOUND: "This product no longer exists. Refresh the page.",
  FORBIDDEN: "Your account is not allowed to manage products.",
  UNAUTHENTICATED: "You are signed out. Please log in again.",
};
function friendly(raw: unknown) {
  const m = typeof raw === "string" ? raw : "";
  if (ERRORS[m]) return ERRORS[m];
  if (m.includes("products_slug_key")) return "That slug is already used by another product.";
  if (m.includes("products_sku_unique_idx")) return "That SKU is already used by another product.";
  return m || "Save failed.";
}
const slugify = (v: string) => v.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const input = "w-full rounded-lg border bg-surface px-3 py-2";
const MAX_IMAGES = 10;
const validImage = (u: string) => /^https:\/\/\S+$/i.test(u) || /^\/[^\s/]\S*$/.test(u);

function ImageRow({ index, url, canRemove, onChange, onRemove }: {
  index: number; url: string; canRemove: boolean; onChange: (v: string) => void; onRemove: () => void;
}) {
  const [broken, setBroken] = useState(false);
  const trimmed = url.trim();
  return <div className="flex items-start gap-3">
    <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-surface-muted text-[10px] text-muted">
      {trimmed && validImage(trimmed)
        // eslint-disable-next-line @next/next/no-img-element
        ? <img key={trimmed} src={trimmed} alt="" referrerPolicy="no-referrer" className={`h-full w-full object-cover ${broken ? "hidden" : ""}`}
            onError={() => setBroken(true)} onLoad={() => setBroken(false)} />
        : "preview"}
      {trimmed && broken && <span className="px-1 text-center text-red-600">can’t load</span>}
    </div>
    <div className="min-w-0 flex-1">
      <input value={url} onChange={(e) => { setBroken(false); onChange(e.target.value); }} placeholder="https://…" className={input}
        aria-label={`Image ${index + 1} link`} />
      <p className="mt-1 text-xs text-muted">{index === 0 ? "Main image (shown first)" : index === 1 ? "Second image (shown on hover)" : `Image ${index + 1}`}</p>
      {trimmed && broken && <p className="mt-1 text-xs text-red-600">This link doesn’t load as an image. Use a direct image link — right-click the picture → “Copy image address”.</p>}
    </div>
    {canRemove && <button type="button" onClick={onRemove} aria-label={`Remove image ${index + 1}`} className="mt-1 rounded-md px-2 py-1 text-lg leading-none text-muted hover:text-red-600">×</button>}
  </div>;
}

export function ProductForm({ product, categories, onSuccess, onCancel }: {
  product?: FormProduct; categories?: CategoryOption[]; onSuccess?: () => void; onCancel?: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [slug, setSlug] = useState<string>(product?.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(Boolean(product));
  const [images, setImages] = useState<string[]>(() => {
    const existing: string[] = (product?.images ?? []).filter(Boolean);
    while (existing.length < 2) existing.push("");
    return existing;
  });

  const showStock = !product || !product.hasVariants;
  const setImage = (i: number, v: string) => setImages((cur) => cur.map((x, k) => (k === i ? v : x)));

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setMessage("");
    const f = new FormData(e.currentTarget);
    const text = (k: string) => String(f.get(k) ?? "").trim();

    const urls = Array.from(new Set(images.map((u) => u.trim()).filter(Boolean)));
    if (urls.length < 2) { setMessage(ERRORS.PRODUCT_NEEDS_TWO_IMAGES); return; }
    if (urls.some((u) => !validImage(u))) { setMessage(ERRORS.INVALID_IMAGE_URL); return; }

    setBusy(true);
    const body = {
      ...(product ? { id: product.id } : {}),
      ...(showStock ? { stock: Number(f.get("stock") || 0) } : {}),
      name: text("name"), slug: text("slug"),
      description: text("description") || null, shortDescription: text("shortDescription") || null,
      categoryId: text("categoryId") || null, brandId: product?.brand_id ?? null,
      price: Number(f.get("price")),
      compareAtPrice: text("compareAtPrice") ? Number(f.get("compareAtPrice")) : null,
      sku: text("sku") || null,
      tags: text("tags").split(",").map((x) => x.trim()).filter(Boolean),
      imageUrls: urls,
      isActive: f.get("isActive") === "on", status: text("status") || "active",
    };
    try {
      const r = await fetch("/api/admin/products", { method: product ? "PATCH" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setMessage(friendly(j.error)); return; }
      setMessage("Saved.");
      router.refresh();
      onSuccess?.();
    } catch { setMessage("Network error. Please try again."); }
    finally { setBusy(false); }
  }

  return <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
    <label className="text-sm"><span className="mb-1 block font-medium">Name *</span>
      <input name="name" required defaultValue={product?.name ?? ""} className={input}
        onChange={(e) => { if (!slugTouched) setSlug(slugify(e.target.value)); }} /></label>
    <label className="text-sm"><span className="mb-1 block font-medium">Slug * <span className="font-normal text-muted">(web address)</span></span>
      <input name="slug" required value={slug} className={input}
        onChange={(e) => { setSlugTouched(true); setSlug(e.target.value); }} /></label>
    <label className="text-sm"><span className="mb-1 block font-medium">Price (₹) *</span>
      <input name="price" type="number" min="0" step="0.01" required defaultValue={product?.price ?? ""} className={input} /></label>
    <label className="text-sm"><span className="mb-1 block font-medium">Compare-at price (₹)</span>
      <input name="compareAtPrice" type="number" min="0" step="0.01" defaultValue={product?.compare_at_price ?? ""} className={input} /></label>
    <label className="text-sm"><span className="mb-1 block font-medium">SKU</span>
      <input name="sku" defaultValue={product?.sku ?? ""} className={input} /></label>
    {showStock
      ? <label className="text-sm"><span className="mb-1 block font-medium">{product ? "Total stock" : "Opening stock"}</span>
          <input name="stock" type="number" min="0" step="1" defaultValue={product ? product.stock : 0} className={input} />
          {product && product.reserved > 0 && <span className="mt-1 block text-xs text-muted">{product.reserved} unit(s) are reserved by pending orders — stock can’t go below that.</span>}
        </label>
      : <div className="text-sm"><span className="mb-1 block font-medium">Stock</span>
          <p className="rounded-lg border bg-surface-muted px-3 py-2 text-muted">This product has variants — manage stock per variant on the Inventory page.</p></div>}

    <div className="sm:col-span-2">
      <span className="mb-1 block text-sm font-medium">Images * <span className="font-normal text-muted">(minimum 2 — paste image links from any website)</span></span>
      <div className="space-y-3">
        {images.map((u, i) => <ImageRow key={i} index={i} url={u} canRemove={images.length > 2}
          onChange={(v) => setImage(i, v)} onRemove={() => setImages((cur) => cur.filter((_, k) => k !== i))} />)}
      </div>
      <button type="button" disabled={images.length >= MAX_IMAGES} onClick={() => setImages((cur) => [...cur, ""])}
        className="mt-3 rounded-lg border px-3 py-1.5 text-sm font-medium disabled:opacity-50">+ Add another image</button>
    </div>

    <label className="text-sm"><span className="mb-1 block font-medium">Category</span>
      <select name="categoryId" defaultValue={product?.category_id ?? ""} className={input}>
        <option value="">Uncategorised</option>
        {(categories ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select></label>
    <label className="text-sm"><span className="mb-1 block font-medium">Status</span>
      <select name="status" defaultValue={product?.status ?? "active"} className={input}>
        <option>draft</option><option>active</option><option>archived</option>
      </select></label>
    <label className="text-sm sm:col-span-2"><span className="mb-1 block font-medium">Short description</span>
      <input name="shortDescription" defaultValue={product?.short_description ?? ""} className={input} /></label>
    <label className="text-sm sm:col-span-2"><span className="mb-1 block font-medium">Description</span>
      <textarea name="description" rows={4} defaultValue={product?.description ?? ""} className={input} /></label>
    <label className="text-sm sm:col-span-2"><span className="mb-1 block font-medium">Tags <span className="font-normal text-muted">(comma separated)</span></span>
      <input name="tags" defaultValue={(product?.tags ?? []).join(", ")} className={input} /></label>
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isActive" defaultChecked={product?.is_active ?? true} /> Active (visible in the shop)</label>
    <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
      <button disabled={busy} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60">{busy ? "Saving…" : product ? "Save changes" : "Save product"}</button>
      {onCancel && <button type="button" onClick={onCancel} className="rounded-lg border px-4 py-2 text-sm font-medium">Cancel</button>}
      {message && <span role="status" className={`text-sm ${message === "Saved." ? "text-green-600" : "text-red-600"}`}>{message}</span>}
    </div>
  </form>;
}
