import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdminPage } from "@/lib/auth/admin";
import { Card } from "@/components/ui/card";
import { NotificationProcessButton } from "@/components/admin/notification-process-button";

export default async function AdminNotificationsPage({searchParams}:{searchParams:Promise<{page?:string}>}) {
  const { role } = await requireAdminPage();
  if (role !== "admin" && role !== "super_admin") redirect("/account/orders");
  const admin = createAdminClient();
  const page = Math.max(1, Number((await searchParams).page ?? 1));
  const { data } = await admin.from("notification_events").select("id,event_type,order_id,delivery_status,provider,provider_message_id,attempt_count,last_attempted_at,sent_at,failure_kind,failure_code,failure_reason,created_at").order("created_at", { ascending: false }).range((page-1)*25,page*25-1);
  return <main className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
    <div className="flex items-end justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[.18em] text-primary">Nuvicart Admin</p><h1 className="mt-2 text-3xl font-semibold tracking-tight">Notifications</h1><p className="mt-2 text-sm text-muted">Operational delivery visibility only. Order, payment and fulfillment state remain authoritative elsewhere.</p></div><NotificationProcessButton /></div>
    <Card className="mt-8 overflow-x-auto"><table className="w-full min-w-[1000px] text-left text-sm"><thead className="bg-surface-muted"><tr>{["Event","Order","Status","Attempts","Provider ID","Last attempt","Failure"].map((h)=><th key={h} className="px-4 py-3 font-semibold">{h}</th>)}</tr></thead><tbody>{(data ?? []).map((n)=><tr key={n.id} className="border-t border-border align-top"><td className="px-4 py-3 font-medium">{n.event_type}</td><td className="px-4 py-3">{n.order_id ?? "—"}</td><td className="px-4 py-3">{n.delivery_status}</td><td className="px-4 py-3">{n.attempt_count}</td><td className="max-w-[220px] break-all px-4 py-3">{n.provider_message_id ?? "—"}</td><td className="px-4 py-3">{n.last_attempted_at ? new Date(n.last_attempted_at).toLocaleString() : "—"}</td><td className="max-w-[280px] px-4 py-3">{n.failure_code ? `${n.failure_code}: ${n.failure_reason ?? ""}` : "—"}</td></tr>)}</tbody></table></Card>
  </main>;
}
