import { requireAdminPage } from "@/lib/auth/admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { ShippingActions } from "./shipping-actions";

export default async function AdminShippingPage({searchParams}:{searchParams:Promise<{page?:string}>}) {
  await requireAdminPage();
  const admin = createAdminClient();
  const page = Math.max(1, Number((await searchParams).page ?? 1));
  const { data } = await admin.from("fulfillments").select("id, status, shipping_provider, provider_order_id, provider_shipment_id, awb_code, carrier, shipping_method, shipping_error, created_at, shipped_at, delivered_at, orders(order_number)").order("created_at", { ascending: false }).range((page-1)*25,page*25-1);
  return <main className="mx-auto max-w-6xl p-8"><div className="flex items-end justify-between"><div><p className="text-xs font-semibold uppercase tracking-[.18em] text-primary">Admin</p><h1 className="mt-2 text-3xl font-semibold">Shipping operations</h1><p className="mt-2 text-sm text-muted">Shiprocket operations remain behind the internal fulfillment engine.</p></div></div><div className="mt-8 overflow-x-auto rounded-2xl border"><table className="w-full text-left text-sm"><thead><tr className="border-b bg-surface-muted"><th className="p-4">Order</th><th className="p-4">Fulfillment</th><th className="p-4">Provider</th><th className="p-4">AWB</th><th className="p-4">Error</th><th className="p-4">Action</th></tr></thead><tbody>{(data ?? []).map((f: { id: string; status: string; shipping_provider: string | null; awb_code: string | null; shipping_error: string | null; orders: { order_number: string } | null })=><tr key={f.id} className="border-b last:border-0"><td className="p-4 font-medium">{f.orders?.order_number ?? f.id}</td><td className="p-4 capitalize">{String(f.status).replaceAll("_"," ")}</td><td className="p-4">{f.shipping_provider ?? "—"}</td><td className="p-4">{f.awb_code ?? "—"}</td><td className="p-4 text-error">{f.shipping_error ?? "—"}</td><td className="p-4"><ShippingActions fulfillmentId={f.id} status={f.status}/></td></tr>)}</tbody></table></div></main>;
}
