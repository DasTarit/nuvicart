"use client";
import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import type { CategoryOption, FormProduct } from "@/lib/admin/product-form-data";
import { Modal } from "./modal";
import { ProductForm } from "./product-form";

export function ProductRowActions({ product, categories }: { product: FormProduct; categories: CategoryOption[] }) {
  const router = useRouter();
  const [mode, setMode] = useState<null | "edit" | "delete">(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const close = useCallback(() => { setMode(null); setMessage(""); }, []);

  async function remove() {
    setBusy(true); setMessage("");
    try {
      const r = await fetch(`/api/admin/products?id=${encodeURIComponent(product.id)}`, { method: "DELETE" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setMessage(typeof j.error === "string" ? j.error : "Delete failed."); return; }
      router.refresh();
      close();
    } catch { setMessage("Network error. Please try again."); }
    finally { setBusy(false); }
  }

  return <>
    <div className="flex items-center gap-2">
      <button type="button" onClick={() => setMode("edit")} className="rounded-md border px-3 py-1 text-xs font-medium hover:bg-surface-muted">Edit</button>
      <button type="button" onClick={() => setMode("delete")} className="rounded-md border border-red-300 px-3 py-1 text-xs font-medium text-red-600 hover:bg-red-50">Delete</button>
    </div>

    {mode === "edit" && <Modal title={`Edit product — ${product.name}`} onClose={close}>
      <ProductForm product={product} categories={categories} onSuccess={close} onCancel={close} />
    </Modal>}

    {mode === "delete" && <Modal title="Delete product?" onClose={close} size="sm">
      <p className="text-sm">You are about to delete <strong>{product.name}</strong>. Its images and stock record will be removed and it will disappear from the shop.</p>
      <p className="mt-3 text-sm text-muted">If customers have already ordered it (or it is used in a promotion), it can’t be erased without breaking order history, so it will be archived (hidden from the shop) instead.</p>
      {message && <p role="alert" className="mt-3 text-sm text-red-600">{message}</p>}
      <div className="mt-5 flex gap-3">
        <button type="button" disabled={busy} onClick={remove} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">{busy ? "Deleting…" : "Yes, delete"}</button>
        <button type="button" onClick={close} className="rounded-lg border px-4 py-2 text-sm font-medium">Cancel</button>
      </div>
    </Modal>}
  </>;
}
