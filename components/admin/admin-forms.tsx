"use client";
import { useState } from "react";

export function ProductForm({ product, categories }: { product?: any; categories?: any[] }) {
  const [busy,setBusy]=useState(false), [message,setMessage]=useState("");
  async function submit(e:React.FormEvent<HTMLFormElement>){e.preventDefault();setBusy(true);setMessage("");const f=new FormData(e.currentTarget);
    const body={...(product?{id:product.id}:{}),name:String(f.get("name")),slug:String(f.get("slug")),description:String(f.get("description")||"")||null,shortDescription:String(f.get("shortDescription")||"")||null,categoryId:String(f.get("categoryId")||"")||null,brandId:null,price:Number(f.get("price")),compareAtPrice:String(f.get("compareAtPrice")||"")?Number(f.get("compareAtPrice")):null,sku:String(f.get("sku")||"")||null,tags:String(f.get("tags")||"").split(",").map(x=>x.trim()).filter(Boolean),imageUrl:String(f.get("imageUrl")||"")||null,isActive:f.get("isActive")==="on",status:String(f.get("status")||"active")};
    const r=await fetch("/api/admin/products",{method:product?"PATCH":"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});const j=await r.json();setMessage(r.ok?"Saved.":j.error??"Save failed.");setBusy(false);if(r.ok)window.location.reload();}
  return <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
    {["name","slug","sku","price","compareAtPrice","imageUrl"].map(k=><label key={k} className="text-sm"><span className="mb-1 block font-medium">{k}</span><input name={k} defaultValue={product?.[k==="compareAtPrice"?"compare_at_price":k]??""} required={["name","slug","price"].includes(k)} className="w-full rounded-lg border bg-surface px-3 py-2"/></label>)}
    <label className="text-sm"><span className="mb-1 block font-medium">Category</span><select name="categoryId" defaultValue={product?.category_id??""} className="w-full rounded-lg border bg-surface px-3 py-2"><option value="">Uncategorised</option>{(categories??[]).map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
    <label className="text-sm"><span className="mb-1 block font-medium">Status</span><select name="status" defaultValue={product?.status??"active"} className="w-full rounded-lg border bg-surface px-3 py-2"><option>draft</option><option>active</option><option>archived</option></select></label>
    <label className="text-sm sm:col-span-2"><span className="mb-1 block font-medium">Short description</span><input name="shortDescription" defaultValue={product?.short_description??""} className="w-full rounded-lg border bg-surface px-3 py-2"/></label>
    <label className="text-sm sm:col-span-2"><span className="mb-1 block font-medium">Description</span><textarea name="description" defaultValue={product?.description??""} rows={4} className="w-full rounded-lg border bg-surface px-3 py-2"/></label>
    <label className="text-sm sm:col-span-2"><span className="mb-1 block font-medium">Tags</span><input name="tags" defaultValue={(product?.tags??[]).join(", ")} className="w-full rounded-lg border bg-surface px-3 py-2"/></label>
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isActive" defaultChecked={product?.is_active??true}/> Active</label>
    <div className="sm:col-span-2 flex items-center gap-3"><button disabled={busy} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">{busy?"Saving…":"Save product"}</button>{message&&<span className="text-sm text-muted">{message}</span>}</div>
  </form>;
}

export function CategoryForm({ category }: { category?: any }) {
  const [busy,setBusy]=useState(false),[message,setMessage]=useState("");
  async function submit(e:React.FormEvent<HTMLFormElement>){e.preventDefault();setBusy(true);const f=new FormData(e.currentTarget);const body={...(category?{id:category.id}:{}),name:String(f.get("name")),slug:String(f.get("slug")),description:String(f.get("description")||"")||null,imageUrl:String(f.get("imageUrl")||"")||null,isActive:f.get("isActive")==="on"};const r=await fetch("/api/admin/categories",{method:category?"PATCH":"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});const j=await r.json();setMessage(r.ok?"Saved.":j.error??"Save failed.");setBusy(false);if(r.ok)window.location.reload();}
  return <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">{["name","slug","imageUrl"].map(k=><input key={k} name={k} placeholder={k} defaultValue={category?.[k==="imageUrl"?"image_url":k]??""} required={k!=="imageUrl"} className="rounded-lg border bg-surface px-3 py-2 text-sm"/>)}<textarea name="description" placeholder="description" defaultValue={category?.description??""} className="rounded-lg border bg-surface px-3 py-2 text-sm sm:col-span-2"/><label className="text-sm"><input type="checkbox" name="isActive" defaultChecked={category?.is_active??true}/> Active</label><div><button disabled={busy} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">{busy?"Saving…":"Save category"}</button>{message&&<span className="ml-3 text-sm text-muted">{message}</span>}</div></form>;
}

export function InventoryAdjustForm({id}:{id:string}) {
  const [busy,setBusy]=useState(false),[message,setMessage]=useState("");
  async function submit(e:React.FormEvent<HTMLFormElement>){e.preventDefault();setBusy(true);const f=new FormData(e.currentTarget);const r=await fetch("/api/admin/inventory",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({inventoryId:id,delta:Number(f.get("delta")),reason:String(f.get("reason"))})});const j=await r.json();setMessage(r.ok?"Adjusted.":j.error??"Adjustment failed.");setBusy(false);if(r.ok)window.location.reload();}
  return <form onSubmit={submit} className="flex flex-wrap items-end gap-2"><input name="delta" type="number" placeholder="Δ qty" required className="w-24 rounded border px-2 py-1 text-sm"/><input name="reason" placeholder="Reason" required className="w-48 rounded border px-2 py-1 text-sm"/><button disabled={busy} className="rounded bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground">{busy?"…":"Adjust"}</button>{message&&<span className="text-xs text-muted">{message}</span>}</form>;
}

export function CancelOrderForm({id}:{id:string}) {
 const [busy,setBusy]=useState(false),[message,setMessage]=useState("");
 async function submit(e:React.FormEvent<HTMLFormElement>){e.preventDefault();setBusy(true);const reason=String(new FormData(e.currentTarget).get("reason"));const r=await fetch("/api/admin/orders",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({orderId:id,action:"cancel",reason})});const j=await r.json();setMessage(r.ok?"Cancelled.":j.error??"Failed.");setBusy(false);if(r.ok)window.location.reload();}
 return <form onSubmit={submit} className="flex gap-2"><input name="reason" required minLength={3} placeholder="Cancellation reason" className="rounded border px-3 py-2 text-sm"/><button disabled={busy} className="rounded bg-error px-3 py-2 text-sm font-semibold text-white">{busy?"…":"Cancel order"}</button>{message&&<span className="text-sm text-muted">{message}</span>}</form>;
}
