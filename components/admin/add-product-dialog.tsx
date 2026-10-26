"use client";
import { useCallback, useState } from "react";
import { Modal } from "./modal";
import { ProductForm } from "./product-form";

export function AddProductDialog({ categories }: { categories: Array<{ id: string; name: string }> }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return <>
    <button type="button" onClick={() => setOpen(true)} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">+ Add product</button>
    {open && <Modal title="Add product" onClose={close}>
      <ProductForm categories={categories} onSuccess={close} onCancel={close} />
    </Modal>}
  </>;
}
